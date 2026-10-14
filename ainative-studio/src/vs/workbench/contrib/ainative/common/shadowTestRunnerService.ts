/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shadow Test Runner Service
 * Executes project test suites autonomously inside the isolated shadow workspace directory
 * before speculative code modifications are promoted to the user's real workspace.
 */

import * as path from '../../../../base/common/path.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IShadowWorkspaceService } from './shadowWorkspaceService.js';

export const IShadowTestRunnerService = createDecorator<IShadowTestRunnerService>('shadowTestRunnerService');

export type TestRunnerType = 'jest' | 'vitest' | 'mocha' | 'pytest' | 'cargo' | 'go' | 'npm' | 'custom' | 'none';

export interface ShadowTestFailure {
	readonly testName: string;
	readonly file?: string;
	readonly line?: number;
	readonly message: string;
	readonly stackTrace?: string;
}

export interface ShadowTestResult {
	readonly status: 'passed' | 'failed' | 'no-runner' | 'timeout' | 'spawn-error';
	readonly runner: TestRunnerType;
	readonly exitCode: number;
	readonly numPassed: number;
	readonly numFailed: number;
	readonly durationMs: number;
	readonly failures: readonly ShadowTestFailure[];
	readonly rawOutput: string;
	readonly errorMessage?: string;
}

export interface IShadowTestRunnerService {
	readonly _serviceBrand: undefined;

	/**
	 * Runs the detected project test runner against a thread's shadow workspace directory.
	 */
	runShadowTests(threadId: string): Promise<ShadowTestResult>;

	/**
	 * Inspects workspace manifests to detect the active test runner.
	 */
	detectRunner(workspaceRootFsPath: string): Promise<{ runner: TestRunnerType; command: string; args: string[] } | null>;
}

function getNodeModule<T = any>(name: string): T | undefined {
	if (typeof process !== 'undefined' && typeof (process as any).getBuiltinModule === 'function') {
		try {
			return (process as any).getBuiltinModule(name);
		} catch {
			// Fallback
		}
	}
	if (typeof require !== 'undefined') {
		try {
			return require(name);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export class ShadowTestRunnerService extends Disposable implements IShadowTestRunnerService {
	readonly _serviceBrand: undefined;

	constructor(
		@IShadowWorkspaceService private readonly _shadowWorkspaceService: IShadowWorkspaceService,
	) {
		super();
	}

	async detectRunner(workspaceRootFsPath: string): Promise<{ runner: TestRunnerType; command: string; args: string[] } | null> {
		const fsMod = getNodeModule('fs');
		if (!fsMod) return null;

		const pkgJsonPath = path.join(workspaceRootFsPath, 'package.json');
		if (fsMod.existsSync(pkgJsonPath)) {
			try {
				const content = fsMod.readFileSync(pkgJsonPath, 'utf8');
				const pkg = JSON.parse(content);

				const testScript = pkg.scripts?.test;
				const devDeps = pkg.devDependencies || {};
				const deps = pkg.dependencies || {};

				if (devDeps.vitest || deps.vitest || (typeof testScript === 'string' && testScript.includes('vitest'))) {
					return { runner: 'vitest', command: 'npx', args: ['vitest', 'run'] };
				}
				if (devDeps.jest || deps.jest || (typeof testScript === 'string' && testScript.includes('jest'))) {
					return { runner: 'jest', command: 'npx', args: ['jest'] };
				}
				if (devDeps.mocha || deps.mocha || (typeof testScript === 'string' && testScript.includes('mocha'))) {
					return { runner: 'mocha', command: 'npx', args: ['mocha'] };
				}
				if (typeof testScript === 'string' && !testScript.includes('no test specified') && !testScript.startsWith('echo')) {
					return { runner: 'npm', command: 'npm', args: ['test'] };
				}
			} catch {
				// Invalid package.json
			}
		}

		// Rust / Cargo
		if (fsMod.existsSync(path.join(workspaceRootFsPath, 'Cargo.toml'))) {
			return { runner: 'cargo', command: 'cargo', args: ['test'] };
		}

		// Go
		if (fsMod.existsSync(path.join(workspaceRootFsPath, 'go.mod'))) {
			return { runner: 'go', command: 'go', args: ['test', './...'] };
		}

		// Python / Pytest
		if (
			fsMod.existsSync(path.join(workspaceRootFsPath, 'pytest.ini')) ||
			fsMod.existsSync(path.join(workspaceRootFsPath, 'conftest.py')) ||
			fsMod.existsSync(path.join(workspaceRootFsPath, 'pyproject.toml')) ||
			fsMod.existsSync(path.join(workspaceRootFsPath, 'setup.cfg'))
		) {
			const venvPytest = path.join(workspaceRootFsPath, '.venv', 'bin', 'pytest');
			if (fsMod.existsSync(venvPytest)) {
				return { runner: 'pytest', command: venvPytest, args: [] };
			}
			return { runner: 'pytest', command: 'pytest', args: [] };
		}

		return null;
	}

	async runShadowTests(threadId: string): Promise<ShadowTestResult> {
		const shadow = this._shadowWorkspaceService.getShadowForThread(threadId);
		if (!shadow || shadow.syncedFsPaths.size === 0) {
			return {
				status: 'no-runner',
				runner: 'none',
				exitCode: 0,
				numPassed: 0,
				numFailed: 0,
				durationMs: 0,
				failures: [],
				rawOutput: ''
			};
		}

		const fileDiffs = await this._shadowWorkspaceService.diffShadowAgainstReal(threadId);
		const firstDiff = fileDiffs[0];
		if (!firstDiff) {
			return {
				status: 'no-runner',
				runner: 'none',
				exitCode: 0,
				numPassed: 0,
				numFailed: 0,
				durationMs: 0,
				failures: [],
				rawOutput: ''
			};
		}

		const relativeToShadowRoot = path.relative(shadow.rootUri.fsPath, firstDiff.shadowUri.fsPath);
		const workspaceFolderBasename = relativeToShadowRoot.split(path.sep)[0];
		const relative = relativeToShadowRoot.split(path.sep).slice(1).join(path.sep);
		const realWorkspaceRootFsPath = relative.length > 0
			? firstDiff.realUri.fsPath.slice(0, firstDiff.realUri.fsPath.length - relative.length - 1)
			: firstDiff.realUri.fsPath;
		const shadowWorkspaceRootFsPath = path.join(shadow.rootUri.fsPath, workspaceFolderBasename);

		const runnerInfo = await this.detectRunner(realWorkspaceRootFsPath);
		if (!runnerInfo) {
			return {
				status: 'no-runner',
				runner: 'none',
				exitCode: 0,
				numPassed: 0,
				numFailed: 0,
				durationMs: 0,
				failures: [],
				rawOutput: ''
			};
		}

		// Ensure dependencies and project manifests are copied/symlinked
		if (runnerInfo.runner === 'jest' || runnerInfo.runner === 'vitest' || runnerInfo.runner === 'mocha' || runnerInfo.runner === 'npm') {
			await this._shadowWorkspaceService.ensureNodeModulesLinked(threadId, URI.file(realWorkspaceRootFsPath));
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'package.json');
		} else if (runnerInfo.runner === 'cargo') {
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'Cargo.toml');
		} else if (runnerInfo.runner === 'go') {
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'go.mod');
		} else if (runnerInfo.runner === 'pytest') {
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'pytest.ini');
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'conftest.py');
			this._copyManifestIfMissing(realWorkspaceRootFsPath, shadowWorkspaceRootFsPath, 'pyproject.toml');
		}

		// Execute test runner in shadow directory
		const cp = getNodeModule('child_process');
		if (!cp) {
			return {
				status: 'spawn-error',
				runner: runnerInfo.runner,
				exitCode: -1,
				numPassed: 0,
				numFailed: 0,
				durationMs: 0,
				failures: [],
				rawOutput: '',
				errorMessage: 'child_process module not available'
			};
		}

		const startTime = Date.now();
		return new Promise<ShadowTestResult>((resolve) => {
			let isTimedOut = false;
			let stdoutData = '';
			let stderrData = '';

			const proc = cp.spawn(runnerInfo.command, runnerInfo.args, {
				cwd: shadowWorkspaceRootFsPath,
				env: {
					...process.env,
					CI: 'true',
					FORCE_COLOR: '0',
					NODE_ENV: 'test'
				},
				shell: false
			});

			const timer = setTimeout(() => {
				isTimedOut = true;
				try {
					proc.kill('SIGTERM');
				} catch {
					// Ignore kill error
				}
			}, DEFAULT_TIMEOUT_MS);

			proc.stdout?.on('data', (chunk: any) => {
				if (stdoutData.length < MAX_OUTPUT_BYTES) {
					stdoutData += chunk.toString();
				}
			});

			proc.stderr?.on('data', (chunk: any) => {
				if (stderrData.length < MAX_OUTPUT_BYTES) {
					stderrData += chunk.toString();
				}
			});

			proc.on('error', (err: any) => {
				clearTimeout(timer);
				resolve({
					status: 'spawn-error',
					runner: runnerInfo.runner,
					exitCode: -1,
					numPassed: 0,
					numFailed: 0,
					durationMs: Date.now() - startTime,
					failures: [],
					rawOutput: stderrData,
					errorMessage: err.message
				});
			});

			proc.on('close', (code: number | null) => {
				clearTimeout(timer);
				const durationMs = Date.now() - startTime;
				const raw = stdoutData + (stderrData ? '\n' + stderrData : '');

				if (isTimedOut) {
					resolve({
						status: 'timeout',
						runner: runnerInfo.runner,
						exitCode: -1,
						numPassed: 0,
						numFailed: 0,
						durationMs,
						failures: [],
						rawOutput: raw,
						errorMessage: `Test execution timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`
					});
					return;
				}

				const exitCode = code ?? 0;
				const parsed = this._parseTestOutput(runnerInfo.runner, raw, exitCode, durationMs);
				resolve(parsed);
			});
		});
	}

	private _copyManifestIfMissing(realRoot: string, shadowRoot: string, fileName: string): void {
		const fsMod = getNodeModule('fs');
		if (!fsMod) return;

		const src = path.join(realRoot, fileName);
		const dst = path.join(shadowRoot, fileName);
		if (fsMod.existsSync(src) && !fsMod.existsSync(dst)) {
			try {
				fsMod.copyFileSync(src, dst);
			} catch {
				// Best-effort copy
			}
		}
	}

	public _parseTestOutput(
		runner: TestRunnerType,
		rawOutput: string,
		exitCode: number,
		durationMs: number
	): ShadowTestResult {
		const failures: ShadowTestFailure[] = [];
		let numPassed = 0;
		let numFailed = 0;

		if (runner === 'jest' || runner === 'vitest') {
			// Extract fail file if present at top
			const failFileMatch = rawOutput.match(/FAIL\s+([^\s\n]+)/);
			const topFile = failFileMatch ? failFileMatch[1].trim() : undefined;

			// Matches: "Tests: 1 failed, 2 passed, 3 total" or "      Tests  2 passed (2)"
			const testsLineMatch = rawOutput.match(/^\s*Tests:?\s+([^\n]+)/im);
			if (testsLineMatch) {
				const pMatch = testsLineMatch[1].match(/(\d+)\s+passed/i);
				if (pMatch) numPassed = parseInt(pMatch[1], 10);
				const fMatch = testsLineMatch[1].match(/(\d+)\s+failed/i);
				if (fMatch) numFailed = parseInt(fMatch[1], 10);
			} else {
				const passedMatch = rawOutput.match(/(\d+)\s+passed/i);
				const failedMatch = rawOutput.match(/(\d+)\s+failed/i);
				if (passedMatch) numPassed = parseInt(passedMatch[1], 10);
				if (failedMatch) numFailed = parseInt(failedMatch[1], 10);
			}

			// Matches: ● TestSuite › TestName
			const failBlocks = rawOutput.split(/●\s+/);
			for (let i = 1; i < failBlocks.length; i++) {
				const block = failBlocks[i].trim();
				const firstLine = block.split('\n')[0].trim();
				const lineMatch = block.match(/>\s*(\d+)\s*\|/);
				const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
				failures.push({
					testName: firstLine,
					file: topFile,
					line,
					message: block.slice(0, 500)
				});
			}
		} else if (runner === 'pytest') {
			// Matches: "=== 1 failed, 2 passed in 0.12s ==="
			const pyMatch = rawOutput.match(/=+\s*(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?in\s+([\d.]+)s/i);
			if (pyMatch) {
				numFailed = pyMatch[1] ? parseInt(pyMatch[1], 10) : 0;
				numPassed = pyMatch[2] ? parseInt(pyMatch[2], 10) : 0;
			} else {
				const pMatch = rawOutput.match(/(\d+)\s+passed/i);
				const fMatch = rawOutput.match(/(\d+)\s+failed/i);
				if (pMatch) numPassed = parseInt(pMatch[1], 10);
				if (fMatch) numFailed = parseInt(fMatch[1], 10);
			}

			// Short summary info: "FAILED tests/test_math.py::test_add - assert 3 == 4"
			const summaryRegex = /^FAILED\s+([^\s:]+)::([^\s-]+)(?:\s+-\s+(.*))?/gm;
			let match: RegExpExecArray | null;
			while ((match = summaryRegex.exec(rawOutput)) !== null) {
				const file = match[1];
				const testName = `${match[1]}::${match[2]}`;
				const message = match[3] || match[0];
				let line: number | undefined;
				const outputLines = rawOutput.split('\n');
				for (const ol of outputLines) {
					if (ol.startsWith(file + ':')) {
						const parts = ol.slice(file.length + 1).split(':');
						const candidate = parseInt(parts[0], 10);
						if (!isNaN(candidate)) {
							line = candidate;
							break;
						}
					}
				}
				failures.push({
					testName,
					file,
					line,
					message
				});
			}

			if (failures.length === 0 && exitCode !== 0) {
				const failLines = rawOutput.match(/^FAILED\s+([^\n]+)/gm);
				if (failLines) {
					for (const fl of failLines) {
						failures.push({
							testName: fl.replace(/^FAILED\s+/, '').trim(),
							message: fl
						});
					}
				}
			}
		} else if (runner === 'cargo') {
			// Matches: "test result: ok. 5 passed; 0 failed;" or "test result: FAILED. 4 passed; 1 failed;"
			const cargoMatch = rawOutput.match(/test result:\s*(?:ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed;/i);
			if (cargoMatch) {
				numPassed = parseInt(cargoMatch[1], 10);
				numFailed = parseInt(cargoMatch[2], 10);
			}

			const failLines = rawOutput.match(/---- ([^\s]+) stdout ----/g);
			if (failLines) {
				for (const fl of failLines) {
					const name = fl.replace(/^---- /, '').replace(/ stdout ----$/, '');
					failures.push({
						testName: name,
						message: `Test ${name} failed during cargo test execution`
					});
				}
			}
		} else if (runner === 'go') {
			// Matches: "--- FAIL: TestFunction (0.01s)"
			const goFails = rawOutput.match(/--- FAIL:\s*([^\s]+)\s*\(([^)]+)\)/g);
			if (goFails) {
				for (const gf of goFails) {
					const name = gf.replace(/^--- FAIL:\s*/, '').split(' ')[0];
					failures.push({
						testName: name,
						message: gf
					});
				}
				numFailed = failures.length;
			}

			const goPass = rawOutput.match(/--- PASS:\s*([^\s]+)/g);
			if (goPass) {
				numPassed = goPass.length;
			}
		}

		if (exitCode !== 0 && numFailed === 0) {
			numFailed = 1;
			failures.push({
				testName: 'TestSuiteExecution',
				message: rawOutput.slice(0, 1000) || `Process exited with code ${exitCode}`
			});
		}

		const status = exitCode === 0 ? 'passed' : 'failed';

		return {
			status,
			runner,
			exitCode,
			numPassed,
			numFailed,
			durationMs,
			failures,
			rawOutput
		};
	}
}

registerSingleton(IShadowTestRunnerService, ShadowTestRunnerService, InstantiationType.Delayed);

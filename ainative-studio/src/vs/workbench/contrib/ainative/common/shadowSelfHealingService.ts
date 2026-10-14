/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IShadowWorkspaceService } from './shadowWorkspaceService.js';
import { IShadowTypeCheckService, ShadowTypeCheckResult } from './shadowTypeCheckService.js';
import { IShadowTestRunnerService, ShadowTestResult } from './shadowTestRunnerService.js';

export const IShadowSelfHealingService = createDecorator<IShadowSelfHealingService>('shadowSelfHealingService');

export interface ShadowSelfHealingVerification {
	readonly passed: boolean;
	readonly hasDiagnostics: boolean;
	readonly hasTestFailures: boolean;
	readonly typeCheckResult: ShadowTypeCheckResult;
	readonly testResult: ShadowTestResult;
	readonly formattedFeedback?: string;
}

export interface IShadowSelfHealingService {
	readonly _serviceBrand: undefined;

	/**
	 * Run compiler diagnostics and project test runners against a thread's shadow workspace.
	 */
	verifyShadowWorkspace(threadId: string): Promise<ShadowSelfHealingVerification>;

	/**
	 * Formats compiler diagnostics and test traces into an actionable prompt for the LLM.
	 */
	formatFeedback(typeCheck: ShadowTypeCheckResult, testResult: ShadowTestResult): string | undefined;
}

export class ShadowSelfHealingService extends Disposable implements IShadowSelfHealingService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IShadowWorkspaceService private readonly _shadowWorkspaceService: IShadowWorkspaceService,
		@IShadowTypeCheckService private readonly _shadowTypeCheckService: IShadowTypeCheckService,
		@IShadowTestRunnerService private readonly _shadowTestRunnerService: IShadowTestRunnerService,
	) {
		super();
	}

	async verifyShadowWorkspace(threadId: string): Promise<ShadowSelfHealingVerification> {
		const shadowDiffs = await this._shadowWorkspaceService.diffShadowAgainstReal(threadId);
		if (shadowDiffs.length === 0) {
			const emptyTypeCheck: ShadowTypeCheckResult = { status: 'ok', diagnostics: [] };
			const emptyTestResult: ShadowTestResult = {
				status: 'no-runner',
				runner: 'none',
				exitCode: 0,
				numPassed: 0,
				numFailed: 0,
				durationMs: 0,
				failures: [],
				rawOutput: ''
			};
			return {
				passed: true,
				hasDiagnostics: false,
				hasTestFailures: false,
				typeCheckResult: emptyTypeCheck,
				testResult: emptyTestResult
			};
		}

		// Run both checks concurrently
		const [typeCheckResult, testResult] = await Promise.all([
			this._shadowTypeCheckService.typeCheckShadow(threadId),
			this._shadowTestRunnerService.runShadowTests(threadId)
		]);

		const hasDiagnostics = typeCheckResult.status === 'diagnostics' && typeCheckResult.diagnostics.length > 0;
		const hasTestFailures = (testResult.status === 'failed' && testResult.numFailed > 0) || testResult.failures.length > 0;
		const passed = !hasDiagnostics && !hasTestFailures;

		let formattedFeedback: string | undefined;
		if (!passed) {
			formattedFeedback = this.formatFeedback(typeCheckResult, testResult);
		}

		return {
			passed,
			hasDiagnostics,
			hasTestFailures,
			typeCheckResult,
			testResult,
			formattedFeedback
		};
	}

	formatFeedback(typeCheck: ShadowTypeCheckResult, testResult: ShadowTestResult): string | undefined {
		const sections: string[] = [];

		if (typeCheck.status === 'diagnostics' && typeCheck.diagnostics.length > 0) {
			const diagLines = typeCheck.diagnostics.slice(0, 10).map(d => {
				const relPath = d.realUri.fsPath || d.realUri.path;
				return `- ${relPath}:${d.line}:${d.column} [${d.severity} ${d.code}]: ${d.message}`;
			});
			if (typeCheck.diagnostics.length > 10) {
				diagLines.push(`- ...and ${typeCheck.diagnostics.length - 10} more diagnostic issue(s).`);
			}
			sections.push(`### Compilation / Type Check Errors:\n${diagLines.join('\n')}`);
		}

		if ((testResult.status === 'failed' && testResult.numFailed > 0) || testResult.failures.length > 0) {
			let failLines: string[] = [];
			if (testResult.failures.length > 0) {
				failLines = testResult.failures.slice(0, 10).map(f => {
					const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
					const header = loc ? `FAIL ${loc} › ${f.testName}` : `FAIL ${f.testName}`;
					const msg = f.message ? `\n  Error: ${f.message.trim()}` : '';
					return `- ${header}${msg}`;
				});
				if (testResult.failures.length > 10) {
					failLines.push(`- ...and ${testResult.failures.length - 10} more failing test(s).`);
				}
			} else {
				failLines.push(`- ${testResult.numFailed} test(s) failed in runner ${testResult.runner}.`);
			}
			sections.push(`### Test Suite Failures (${testResult.runner}):\n${failLines.join('\n')}`);
		}

		if (sections.length === 0) {
			return undefined;
		}

		return `[Autonomous Verification Feedback]
The speculative changes staged in the shadow workspace encountered errors:

${sections.join('\n\n')}

Please inspect the errors above and use your code editing tools to correct the implementation in the shadow workspace.`;
	}
}

registerSingleton(IShadowSelfHealingService, ShadowSelfHealingService, InstantiationType.Delayed);

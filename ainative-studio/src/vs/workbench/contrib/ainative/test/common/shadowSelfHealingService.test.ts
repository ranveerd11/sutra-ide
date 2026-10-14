/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { FileDiff, IShadowWorkspaceService } from '../../common/shadowWorkspaceService.js';
import { IShadowTypeCheckService, ShadowTypeCheckDiagnostic, ShadowTypeCheckResult } from '../../common/shadowTypeCheckService.js';
import { IShadowTestRunnerService, ShadowTestFailure, ShadowTestResult } from '../../common/shadowTestRunnerService.js';
import { ShadowSelfHealingService } from '../../common/shadowSelfHealingService.js';

suite('ShadowSelfHealingService Tests', function () {
	let disposables: DisposableStore;

	setup(() => {
		disposables = new DisposableStore();
	});

	teardown(() => {
		disposables.dispose();
	});

	function createService(options?: {
		diffs?: FileDiff[];
		typeCheckResult?: ShadowTypeCheckResult;
		testResult?: ShadowTestResult;
	}) {
		const mockShadowWorkspaceService: Partial<IShadowWorkspaceService> = {
			diffShadowAgainstReal: async () => options?.diffs ?? []
		};

		const mockTypeCheckService: Partial<IShadowTypeCheckService> = {
			typeCheckShadow: async () => options?.typeCheckResult ?? { status: 'ok', diagnostics: [] }
		};

		const mockTestRunnerService: Partial<IShadowTestRunnerService> = {
			runShadowTests: async () => options?.testResult ?? {
				status: 'passed',
				runner: 'jest',
				exitCode: 0,
				numPassed: 10,
				numFailed: 0,
				durationMs: 150,
				failures: [],
				rawOutput: 'PASS all tests passed'
			}
		};

		return disposables.add(new ShadowSelfHealingService(
			mockShadowWorkspaceService as IShadowWorkspaceService,
			mockTypeCheckService as IShadowTypeCheckService,
			mockTestRunnerService as IShadowTestRunnerService
		));
	}

	test('verifyShadowWorkspace short-circuits when no shadow diffs exist', async () => {
		const service = createService({ diffs: [] });
		const result = await service.verifyShadowWorkspace('thread-1');

		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.hasDiagnostics, false);
		assert.strictEqual(result.hasTestFailures, false);
		assert.strictEqual(result.formattedFeedback, undefined);
		assert.strictEqual(result.typeCheckResult.status, 'ok');
		assert.strictEqual(result.testResult.status, 'no-runner');
	});

	test('verifyShadowWorkspace reports passed when diagnostics are empty and tests pass', async () => {
		const fakeDiff: FileDiff = {
			realUri: URI.file('/workspace/src/app.ts'),
			shadowUri: URI.file('/tmp/shadow/src/app.ts'),
			kind: 'modified',
			realContent: '',
			shadowContent: 'const a: number = 1;',
			conflict: false
		};

		const service = createService({
			diffs: [fakeDiff],
			typeCheckResult: { status: 'ok', diagnostics: [] },
			testResult: {
				status: 'passed',
				runner: 'vitest',
				exitCode: 0,
				numPassed: 5,
				numFailed: 0,
				durationMs: 80,
				failures: [],
				rawOutput: '5 passed'
			}
		});

		const result = await service.verifyShadowWorkspace('thread-2');
		assert.strictEqual(result.passed, true);
		assert.strictEqual(result.hasDiagnostics, false);
		assert.strictEqual(result.hasTestFailures, false);
		assert.strictEqual(result.formattedFeedback, undefined);
	});

	test('verifyShadowWorkspace detects compiler diagnostics and formats structured prompt', async () => {
		const fakeDiff: FileDiff = {
			realUri: URI.file('/workspace/src/calc.ts'),
			shadowUri: URI.file('/tmp/shadow/src/calc.ts'),
			kind: 'modified',
			realContent: '',
			shadowContent: 'const x: number = "bad";',
			conflict: false
		};

		const diagnostic: ShadowTypeCheckDiagnostic = {
			realUri: URI.file('/workspace/src/calc.ts'),
			line: 10,
			column: 5,
			severity: 'error',
			code: 'TS2322',
			message: "Type 'string' is not assignable to type 'number'."
		};

		const service = createService({
			diffs: [fakeDiff],
			typeCheckResult: {
				status: 'diagnostics',
				diagnostics: [diagnostic]
			},
			testResult: {
				status: 'passed',
				runner: 'jest',
				exitCode: 0,
				numPassed: 2,
				numFailed: 0,
				durationMs: 40,
				failures: [],
				rawOutput: ''
			}
		});

		const result = await service.verifyShadowWorkspace('thread-3');
		assert.strictEqual(result.passed, false);
		assert.strictEqual(result.hasDiagnostics, true);
		assert.strictEqual(result.hasTestFailures, false);
		assert.ok(result.formattedFeedback?.includes('Autonomous Verification Feedback'));
		assert.ok(result.formattedFeedback?.includes('Compilation / Type Check Errors:'));
		assert.ok(result.formattedFeedback?.includes('/workspace/src/calc.ts:10:5 [error TS2322]'));
		assert.ok(result.formattedFeedback?.includes("Type 'string' is not assignable to type 'number'"));
	});

	test('verifyShadowWorkspace detects test suite failures and formats failure traces', async () => {
		const fakeDiff: FileDiff = {
			realUri: URI.file('/workspace/src/service.ts'),
			shadowUri: URI.file('/tmp/shadow/src/service.ts'),
			kind: 'modified',
			realContent: '',
			shadowContent: 'export function add() { return 5; }',
			conflict: false
		};

		const failure: ShadowTestFailure = {
			testName: 'Calculator adds numbers',
			file: 'test/calc.test.ts',
			line: 14,
			message: 'Expected 4, received 5'
		};

		const service = createService({
			diffs: [fakeDiff],
			typeCheckResult: { status: 'ok', diagnostics: [] },
			testResult: {
				status: 'failed',
				runner: 'jest',
				exitCode: 1,
				numPassed: 1,
				numFailed: 1,
				durationMs: 95,
				failures: [failure],
				rawOutput: 'FAIL test/calc.test.ts'
			}
		});

		const result = await service.verifyShadowWorkspace('thread-4');
		assert.strictEqual(result.passed, false);
		assert.strictEqual(result.hasDiagnostics, false);
		assert.strictEqual(result.hasTestFailures, true);
		assert.ok(result.formattedFeedback?.includes('Test Suite Failures (jest)'));
		assert.ok(result.formattedFeedback?.includes('FAIL test/calc.test.ts:14 › Calculator adds numbers'));
		assert.ok(result.formattedFeedback?.includes('Error: Expected 4, received 5'));
	});

	test('verifyShadowWorkspace combines compilation diagnostics and test failures', async () => {
		const fakeDiff: FileDiff = {
			realUri: URI.file('/workspace/src/both.ts'),
			shadowUri: URI.file('/tmp/shadow/src/both.ts'),
			kind: 'modified',
			realContent: '',
			shadowContent: 'bad code',
			conflict: false
		};

		const diag: ShadowTypeCheckDiagnostic = {
			realUri: URI.file('/workspace/src/both.ts'),
			line: 1,
			column: 1,
			severity: 'error',
			code: 'TS1005',
			message: "';' expected."
		};

		const failure: ShadowTestFailure = {
			testName: 'Module loads',
			message: 'SyntaxError: unexpected token'
		};

		const service = createService({
			diffs: [fakeDiff],
			typeCheckResult: { status: 'diagnostics', diagnostics: [diag] },
			testResult: {
				status: 'failed',
				runner: 'pytest',
				exitCode: 1,
				numPassed: 0,
				numFailed: 1,
				durationMs: 50,
				failures: [failure],
				rawOutput: 'ERRORS'
			}
		});

		const result = await service.verifyShadowWorkspace('thread-5');
		assert.strictEqual(result.passed, false);
		assert.strictEqual(result.hasDiagnostics, true);
		assert.strictEqual(result.hasTestFailures, true);
		assert.ok(result.formattedFeedback?.includes('Compilation / Type Check Errors:'));
		assert.ok(result.formattedFeedback?.includes('Test Suite Failures (pytest)'));
	});

	test('formatFeedback truncates lists exceeding 10 entries with count summary', () => {
		const service = createService();
		const diags: ShadowTypeCheckDiagnostic[] = Array.from({ length: 15 }, (_, i) => ({
			realUri: URI.file(`/workspace/file_${i}.ts`),
			line: i + 1,
			column: 1,
			severity: 'error',
			code: `TS${1000 + i}`,
			message: `Error number ${i}`
		}));

		const failures: ShadowTestFailure[] = Array.from({ length: 12 }, (_, i) => ({
			testName: `Test case ${i}`,
			message: `Failure message ${i}`
		}));

		const feedback = service.formatFeedback(
			{ status: 'diagnostics', diagnostics: diags },
			{
				status: 'failed',
				runner: 'jest',
				exitCode: 1,
				numPassed: 0,
				numFailed: 12,
				durationMs: 100,
				failures,
				rawOutput: ''
			}
		);

		assert.ok(feedback);
		assert.ok(feedback.includes('...and 5 more diagnostic issue(s).'));
		assert.ok(feedback.includes('...and 2 more failing test(s).'));
	});
});

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { URI } from '../../../../../base/common/uri.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { DiskFileSystemProvider } from '../../../../../platform/files/node/diskFileSystemProvider.js';
import { Schemas } from '../../../../../base/common/network.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ShadowWorkspaceService } from '../../common/shadowWorkspaceService.js';
import { ShadowTestRunnerService } from '../../common/shadowTestRunnerService.js';

suite('ShadowTestRunnerService Tests', function () {
	this.timeout(20000);

	let shadowWorkspaceService: ShadowWorkspaceService;
	let testRunnerService: ShadowTestRunnerService;
	let fileService: FileService;
	let disposables: DisposableStore;
	let testWorkspaceDir: URI;

	setup(async () => {
		disposables = new DisposableStore();

		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const diskProvider = disposables.add(new DiskFileSystemProvider(logService));
		fileService.registerProvider(Schemas.file, diskProvider);

		testWorkspaceDir = URI.file(path.join(tmpdir(), 'ainative-testrunner-test-workspace-' + Date.now() + '-' + Math.random().toString(36).slice(2)));
		await fileService.createFolder(testWorkspaceDir);

		shadowWorkspaceService = disposables.add(new ShadowWorkspaceService(fileService));
		testRunnerService = disposables.add(new ShadowTestRunnerService(shadowWorkspaceService));
	});

	teardown(async () => {
		try {
			await fileService.del(testWorkspaceDir, { recursive: true });
		} catch {
			// ignore cleanup errors
		}
		disposables.dispose();
	});

	test('runShadowTests returns no-runner for a thread with no shadow workspace', async () => {
		const result = await testRunnerService.runShadowTests('non-existent-thread');
		assert.strictEqual(result.status, 'no-runner');
		assert.strictEqual(result.runner, 'none');
		assert.strictEqual(result.exitCode, 0);
		assert.deepStrictEqual(result.failures, []);
	});

	test('detectRunner detects Vitest from package.json devDependencies', async () => {
		const pkgJsonPath = path.join(testWorkspaceDir.fsPath, 'package.json');
		fs.writeFileSync(pkgJsonPath, JSON.stringify({
			name: 'test-app',
			devDependencies: {
				vitest: '^1.0.0'
			}
		}, null, 2));

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'vitest');
		assert.strictEqual(detected.command, 'npx');
		assert.deepStrictEqual(detected.args, ['vitest', 'run']);
	});

	test('detectRunner detects Jest from package.json devDependencies', async () => {
		const pkgJsonPath = path.join(testWorkspaceDir.fsPath, 'package.json');
		fs.writeFileSync(pkgJsonPath, JSON.stringify({
			name: 'test-app',
			devDependencies: {
				jest: '^29.0.0'
			}
		}, null, 2));

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'jest');
		assert.strictEqual(detected.command, 'npx');
		assert.deepStrictEqual(detected.args, ['jest']);
	});

	test('detectRunner detects Mocha from package.json scripts', async () => {
		const pkgJsonPath = path.join(testWorkspaceDir.fsPath, 'package.json');
		fs.writeFileSync(pkgJsonPath, JSON.stringify({
			name: 'test-app',
			scripts: {
				test: 'mocha --timeout 5000'
			}
		}, null, 2));

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'mocha');
		assert.strictEqual(detected.command, 'npx');
		assert.deepStrictEqual(detected.args, ['mocha']);
	});

	test('detectRunner detects custom npm test script fallback', async () => {
		const pkgJsonPath = path.join(testWorkspaceDir.fsPath, 'package.json');
		fs.writeFileSync(pkgJsonPath, JSON.stringify({
			name: 'test-app',
			scripts: {
				test: 'node run-my-tests.js'
			}
		}, null, 2));

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'npm');
		assert.strictEqual(detected.command, 'npm');
		assert.deepStrictEqual(detected.args, ['test']);
	});

	test('detectRunner detects Cargo workspace from Cargo.toml', async () => {
		const cargoPath = path.join(testWorkspaceDir.fsPath, 'Cargo.toml');
		fs.writeFileSync(cargoPath, '[package]\nname = "rust_test"\nversion = "0.1.0"\n');

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'cargo');
		assert.strictEqual(detected.command, 'cargo');
		assert.deepStrictEqual(detected.args, ['test']);
	});

	test('detectRunner detects Go module from go.mod', async () => {
		const goModPath = path.join(testWorkspaceDir.fsPath, 'go.mod');
		fs.writeFileSync(goModPath, 'module example.com/test\n\ngo 1.21\n');

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'go');
		assert.strictEqual(detected.command, 'go');
		assert.deepStrictEqual(detected.args, ['test', './...']);
	});

	test('detectRunner detects Pytest from pytest.ini', async () => {
		const pytestPath = path.join(testWorkspaceDir.fsPath, 'pytest.ini');
		fs.writeFileSync(pytestPath, '[pytest]\nminversion = 6.0\n');

		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.ok(detected);
		assert.strictEqual(detected.runner, 'pytest');
		assert.strictEqual(detected.command, 'pytest');
		assert.deepStrictEqual(detected.args, []);
	});

	test('detectRunner returns null when no test manifests are found', async () => {
		const detected = await testRunnerService.detectRunner(testWorkspaceDir.fsPath);
		assert.strictEqual(detected, null);
	});

	test('parseTestOutput parses Jest failure logs correctly', () => {
		const jestOutput = `
FAIL src/calculator.test.ts
  ● Calculator › adds two numbers

    expect(received).toBe(expected) // Object.is equality

    Expected: 4
    Received: 5

      12 |     test('adds two numbers', () => {
      13 |         const calc = new Calculator();
    > 14 |         expect(calc.add(2, 2)).toBe(4);
         |                                ^
      15 |     });

Tests: 1 failed, 4 passed, 5 total
Snapshots: 0 total
Time: 1.234 s
`;
		const parsed = (testRunnerService as any)._parseTestOutput('jest', jestOutput, 1, 1234);
		assert.strictEqual(parsed.status, 'failed');
		assert.strictEqual(parsed.exitCode, 1);
		assert.strictEqual(parsed.numFailed, 1);
		assert.strictEqual(parsed.numPassed, 4);
		assert.ok(parsed.failures.length >= 1);
		assert.strictEqual(parsed.failures[0].testName, 'Calculator › adds two numbers');
		assert.strictEqual(parsed.failures[0].file, 'src/calculator.test.ts');
		assert.strictEqual(parsed.failures[0].line, 14);
	});

	test('parseTestOutput parses Pytest failure logs correctly', () => {
		const pytestOutput = `
============================= test session starts ==============================
collected 3 items

tests/test_math.py::test_multiply PASSED                                 [ 33%]
tests/test_math.py::test_divide PASSED                                   [ 66%]
tests/test_math.py::test_add FAILED                                      [100%]

=================================== FAILURES ===================================
___________________________________ test_add ___________________________________

    def test_add():
>       assert add(1, 2) == 4
E       assert 3 == 4

tests/test_math.py:10: AssertionError
=========================== short test summary info ============================
FAILED tests/test_math.py::test_add - assert 3 == 4
========================= 1 failed, 2 passed in 0.05s ==========================
`;
		const parsed = (testRunnerService as any)._parseTestOutput('pytest', pytestOutput, 1, 50);
		assert.strictEqual(parsed.status, 'failed');
		assert.strictEqual(parsed.exitCode, 1);
		assert.strictEqual(parsed.numFailed, 1);
		assert.strictEqual(parsed.numPassed, 2);
		assert.strictEqual(parsed.failures.length, 1);
		assert.strictEqual(parsed.failures[0].testName, 'tests/test_math.py::test_add');
		assert.strictEqual(parsed.failures[0].file, 'tests/test_math.py');
		assert.strictEqual(parsed.failures[0].line, 10);
	});

	test('parseTestOutput parses Go test failure output correctly', () => {
		const goOutput = `
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- FAIL: TestSubtract (0.01s)
    calc_test.go:25: expected 10, got 8
FAIL
FAIL	example.com/math	0.015s
`;
		const parsed = (testRunnerService as any)._parseTestOutput('go', goOutput, 1, 15);
		assert.strictEqual(parsed.status, 'failed');
		assert.strictEqual(parsed.exitCode, 1);
		assert.strictEqual(parsed.numFailed, 1);
		assert.strictEqual(parsed.numPassed, 1);
		assert.strictEqual(parsed.failures[0].testName, 'TestSubtract');
	});

	test('parseTestOutput handles clean passing test suites', () => {
		const vitestPass = `
 ✓ src/index.test.ts (2 tests) 5ms
 
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  18:00:00
   Duration  250ms
`;
		const parsed = (testRunnerService as any)._parseTestOutput('vitest', vitestPass, 0, 250);
		assert.strictEqual(parsed.status, 'passed');
		assert.strictEqual(parsed.exitCode, 0);
		assert.strictEqual(parsed.numFailed, 0);
		assert.strictEqual(parsed.numPassed, 2);
		assert.strictEqual(parsed.failures.length, 0);
	});
});

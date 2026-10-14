/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { URI } from '../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import {
	SUTRA_BRIDGE_PROTOCOL_VERSION,
	SUTRA_BRIDGE_SERVER_NAME,
	SUTRA_BRIDGE_SERVER_VERSION,
	JSON_RPC_ERRORS
} from '../../../common/bridge/sutraBridgeTypes.js';
import { SutraBridgeDispatcher } from '../../../common/bridge/sutraBridgeDispatcher.js';
import { SutraAgenticBridgeService } from '../../../common/bridge/sutraAgenticBridgeService.js';
import { ICodeIntelligenceService } from '../../../common/codeIntelligenceService.js';
import { IShadowTestRunnerService } from '../../../common/shadowTestRunnerService.js';
import { IShadowWorkspaceService } from '../../../common/shadowWorkspaceService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IWorkspaceContextService, Workspace, WorkspaceFolder } from '../../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { SutraBridgeStdioRunner } from '../../../common/bridge/sutraBridgeRunner.js';

suite('Sutra Open Agentic Bridge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('SutraBridgeDispatcher Protocol Tests', () => {
		test('should respond to "initialize" handshake with MCP specification capabilities', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const request = {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'claude-code', version: '1.0.0' }
				}
			};

			const response = await dispatcher.dispatch(request);
			assert.ok(response);
			assert.strictEqual(response?.jsonrpc, '2.0');
			assert.strictEqual(response?.id, 1);
			assert.strictEqual(response?.result.protocolVersion, SUTRA_BRIDGE_PROTOCOL_VERSION);
			assert.strictEqual(response?.result.serverInfo.name, SUTRA_BRIDGE_SERVER_NAME);
			assert.strictEqual(response?.result.serverInfo.version, SUTRA_BRIDGE_SERVER_VERSION);
			assert.strictEqual(typeof response?.result.capabilities.tools, 'object');
		});

		test('should acknowledge notifications/initialized without returning a response', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const notification = {
				jsonrpc: '2.0',
				method: 'notifications/initialized'
			};

			const response = await dispatcher.dispatch(notification);
			assert.strictEqual(response, null);

			const stats = dispatcher.getStats();
			assert.strictEqual(stats.activeSessions, 1);
		});

		test('should respond to ping request', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 'ping-123',
				method: 'ping'
			});

			assert.ok(response);
			assert.strictEqual(response?.id, 'ping-123');
			assert.deepStrictEqual(response?.result, {});
		});

		test('should return all 5 registered tools in tools/list', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list'
			});

			assert.ok(response?.result?.tools);
			assert.strictEqual(response?.result.tools.length, 5);

			const toolNames = response?.result.tools.map((t: any) => t.name);
			assert.ok(toolNames.includes('sutra_get_ast'));
			assert.ok(toolNames.includes('sutra_hybrid_search'));
			assert.ok(toolNames.includes('sutra_shadow_verify'));
			assert.ok(toolNames.includes('sutra_get_editor_state'));
			assert.ok(toolNames.includes('sutra_apply_staged_diff'));
		});

		test('should dispatch tools/call and format result as MCP text content', async () => {
			let capturedArgs: any = null;
			const dispatcher = new SutraBridgeDispatcher(async (name, args) => {
				if (name === 'sutra_get_ast') {
					capturedArgs = args;
					return { symbolCount: 2, symbols: [{ name: 'testFn', kind: 'function' }] };
				}
				return null;
			});

			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'sutra_get_ast',
					arguments: { code: 'function testFn() {}', language: 'typescript' }
				}
			});

			assert.ok(response?.result);
			assert.strictEqual(response?.result.isError, false);
			assert.strictEqual(response?.result.content.length, 1);
			assert.strictEqual(response?.result.content[0].type, 'text');

			const parsedPayload = JSON.parse(response?.result.content[0].text);
			assert.strictEqual(parsedPayload.symbolCount, 2);
			assert.strictEqual(capturedArgs.code, 'function testFn() {}');

			const stats = dispatcher.getStats();
			assert.strictEqual(stats.toolInvocations['sutra_get_ast'], 1);
		});

		test('should return isError: true when tool execution throws an exception', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => {
				throw new Error('Test execution failure');
			});

			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: {
					name: 'sutra_shadow_verify',
					arguments: {}
				}
			});

			assert.ok(response?.result);
			assert.strictEqual(response?.result.isError, true);
			assert.ok(response?.result.content[0].text.includes('Test execution failure'));
		});

		test('should return JSON-RPC error for unknown tool call', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: {
					name: 'unknown_tool_xyz'
				}
			});

			assert.ok(response?.error);
			assert.strictEqual(response?.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
		});

		test('should return JSON-RPC error for unknown method', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch({
				jsonrpc: '2.0',
				id: 6,
				method: 'invalid/method'
			});

			assert.ok(response?.error);
			assert.strictEqual(response?.error.code, JSON_RPC_ERRORS.METHOD_NOT_FOUND);
		});

		test('should return JSON-RPC parse error for malformed JSON string', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch('{ malformed json ');

			assert.ok(response?.error);
			assert.strictEqual(response?.error.code, JSON_RPC_ERRORS.PARSE_ERROR);
		});

		test('should return invalid request error when jsonrpc header is missing', async () => {
			const dispatcher = new SutraBridgeDispatcher(async () => ({}));
			const response = await dispatcher.dispatch({
				id: 7,
				method: 'initialize'
			});

			assert.ok(response?.error);
			assert.strictEqual(response?.error.code, JSON_RPC_ERRORS.INVALID_REQUEST);
		});
	});

	suite('SutraAgenticBridgeService Integration & Tool Handlers', () => {
		let bridgeService: SutraAgenticBridgeService;
		let mockCodeIntel: Partial<ICodeIntelligenceService>;
		let mockShadowTestRunner: Partial<IShadowTestRunnerService>;
		let mockShadowWorkspace: Partial<IShadowWorkspaceService>;
		let mockFileService: Partial<IFileService>;
		let mockWorkspaceContext: Partial<IWorkspaceContextService>;
		let mockEditorService: Partial<IEditorService>;

		setup(() => {
			mockCodeIntel = {
				analyzeComplexity: async (code: string, lang: any) => ({
					language: lang,
					cyclomaticComplexity: 3,
					cognitiveComplexity: 2,
					maintainabilityIndex: 85,
					averageComplexity: 3,
					maxComplexity: 3,
					totalFunctions: 1,
					functions: []
				}),
				parseAST: async (code: string, lang: any) => ({
					symbols: [
						{ name: 'calculateTotal', kind: 'function', lineStart: 1, lineEnd: 5 } as any
					],
					language: lang,
					rootNode: null as any,
					tree: null as any
				}),
				findReferences: async (code: string, lang: any, symbolName: string) => ({
					symbol: symbolName,
					callers: [],
					callees: [],
					references: []
				} as any),
				analyzeImports: async (code: string, lang: any) => ({
					language: lang,
					count: 2,
					imports: ['express', 'node:fs']
				})
			};

			mockShadowTestRunner = {
				runShadowTests: async (_threadId: string) => ({
					status: 'passed',
					runner: 'jest',
					exitCode: 0,
					numPassed: 12,
					numFailed: 0,
					durationMs: 420,
					failures: [],
					rawOutput: 'PASS src/index.test.ts'
				})
			};

			mockShadowWorkspace = {
				createShadowForThread: async (threadId: string) => ({
					threadId,
					rootUri: URI.file(`/tmp/shadow/${threadId}`),
					syncedFsPaths: new Set<string>()
				})
			};

			const mockFs = new Map<string, string>();
			mockFileService = {
				readFile: async (uri) => ({
					value: VSBuffer.fromString(mockFs.get(uri.fsPath) || 'export const PI = 3.14;')
				} as any),
				writeFile: async (uri, buffer) => {
					mockFs.set(uri.fsPath, buffer.toString());
					return {} as any;
				}
			};

			mockWorkspaceContext = {
				getWorkspace: () => new Workspace(
					'test-workspace',
					[new WorkspaceFolder({ uri: URI.file('/workspace/project'), name: 'project', index: 0 }, undefined)],
					false,
					null,
					() => false
				)
			};

			mockEditorService = {
				activeEditor: {
					resource: URI.file('/workspace/project/src/app.ts'),
					getName: () => 'app.ts'
				} as any,
				activeEditorPane: {
					getControl: () => ({
						getPosition: () => ({ lineNumber: 42, column: 15 }),
						getSelection: () => ({ startLineNumber: 42, startColumn: 1, endLineNumber: 42, endColumn: 20 })
					})
				} as any,
				getEditors: () => [
					{ editor: { resource: URI.file('/workspace/project/src/app.ts'), getName: () => 'app.ts' } } as any,
					{ editor: { resource: URI.file('/workspace/project/src/index.ts'), getName: () => 'index.ts' } } as any
				]
			};

			bridgeService = new SutraAgenticBridgeService(
				mockCodeIntel as ICodeIntelligenceService,
				mockShadowTestRunner as IShadowTestRunnerService,
				mockShadowWorkspace as IShadowWorkspaceService,
				mockFileService as IFileService,
				mockWorkspaceContext as IWorkspaceContextService,
				mockEditorService as IEditorService
			);
		});

		teardown(() => {
			bridgeService.dispose();
		});

		test('should execute sutra_get_ast complexity analysis', async () => {
			const result = await bridgeService.executeTool('sutra_get_ast', {
				code: 'function compute() { if (true) return 1; return 0; }',
				language: 'typescript',
				mode: 'complexity'
			});

			assert.strictEqual(result.cyclomaticComplexity, 3);
			assert.strictEqual(result.maintainabilityIndex, 85);
		});

		test('should execute sutra_get_ast symbol extraction', async () => {
			const result = await bridgeService.executeTool('sutra_get_ast', {
				code: 'function calculateTotal() {}',
				language: 'typescript',
				mode: 'symbols'
			});

			assert.strictEqual(result.symbolCount, 1);
			assert.strictEqual(result.symbols[0].name, 'calculateTotal');
		});

		test('should execute sutra_shadow_verify with speculative file changes', async () => {
			const result = await bridgeService.executeTool('sutra_shadow_verify', {
				threadId: 'thread-test-1',
				files: [
					{ path: 'src/app.ts', content: 'export function app() { return true; }' }
				]
			});

			assert.strictEqual(result.status, 'passed');
			assert.strictEqual(result.runner, 'jest');
			assert.strictEqual(result.numPassed, 12);
		});

		test('should execute sutra_get_editor_state returning active file and cursor', async () => {
			const state = await bridgeService.executeTool('sutra_get_editor_state', {});

			assert.strictEqual(state.activeFile, '/workspace/project/src/app.ts');
			assert.strictEqual(state.cursor.line, 42);
			assert.strictEqual(state.cursor.column, 15);
			assert.strictEqual(state.openTabs.length, 2);
		});

		test('should execute sutra_apply_staged_diff with direct write and stageOnly options', async () => {
			const stageRes = await bridgeService.executeTool('sutra_apply_staged_diff', {
				filePath: 'src/component.ts',
				content: 'export const Comp = () => null;',
				stageOnly: true
			});
			assert.strictEqual(stageRes.status, 'staged');

			const applyRes = await bridgeService.executeTool('sutra_apply_staged_diff', {
				filePath: 'src/component.ts',
				content: 'export const Comp = () => null;',
				stageOnly: false
			});
			assert.strictEqual(applyRes.status, 'applied');
		});

		test('should generate external agent configurations for Claude Code, Codex, and Aider', () => {
			const claudeCfg = bridgeService.generateExternalAgentConfig('claude', '/custom/bin/sutra-bridge');
			assert.strictEqual(claudeCfg.agent, 'claude');
			assert.strictEqual(claudeCfg.format, 'json');
			const parsedClaude = JSON.parse(claudeCfg.content);
			assert.strictEqual(parsedClaude.mcpServers.sutra.args[0], '/custom/bin/sutra-bridge');

			const codexCfg = bridgeService.generateExternalAgentConfig('codex', '/custom/bin/sutra-bridge');
			assert.strictEqual(codexCfg.agent, 'codex');
			const parsedCodex = JSON.parse(codexCfg.content);
			assert.strictEqual(parsedCodex.mcpServers.sutra.args[0], '/custom/bin/sutra-bridge');

			const aiderCfg = bridgeService.generateExternalAgentConfig('aider', '/custom/bin/sutra-bridge');
			assert.strictEqual(aiderCfg.agent, 'aider');
			assert.strictEqual(aiderCfg.format, 'yaml');
			assert.ok(aiderCfg.content.includes('/custom/bin/sutra-bridge'));
		});
	});

	suite('SutraBridgeStdioRunner Standalone Mode', () => {
		test('should parse and process newline-delimited JSON-RPC messages', async () => {
			const runner = new SutraBridgeStdioRunner(':memory:');
			const requestLine = JSON.stringify({
				jsonrpc: '2.0',
				id: 'stdio-test-1',
				method: 'initialize',
				params: { protocolVersion: '2024-11-05' }
			});

			const responseLine = await runner.processLine(requestLine);
			assert.ok(responseLine);

			const parsed = JSON.parse(responseLine!);
			assert.strictEqual(parsed.id, 'stdio-test-1');
			assert.strictEqual(parsed.result.serverInfo.name, SUTRA_BRIDGE_SERVER_NAME);
		});

		test('should return null for empty or whitespace-only lines', async () => {
			const runner = new SutraBridgeStdioRunner(':memory:');
			const emptyRes = await runner.processLine('   ');
			assert.strictEqual(emptyRes, null);
		});
	});
});

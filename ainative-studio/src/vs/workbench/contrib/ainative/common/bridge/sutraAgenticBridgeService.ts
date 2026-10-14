/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ICodeIntelligenceService, CodeLanguage } from '../codeIntelligenceService.js';
import { normalizeLanguage } from '../treeSitterAnalyzer.js';
import { IShadowTestRunnerService } from '../shadowTestRunnerService.js';
import { IShadowWorkspaceService } from '../shadowWorkspaceService.js';
import { LocalVectorStore } from '../localVectorStore.js';
import { SutraBridgeDispatcher } from './sutraBridgeDispatcher.js';
import {
	ISutraAgenticBridgeService,
	JsonRpcResponse,
	MCPToolDefinition,
	SUTRA_BRIDGE_TOOLS,
	SutraBridgeStats,
	SutraGetAstParams,
	SutraHybridSearchParams,
	SutraShadowVerifyParams,
	SutraGetEditorStateParams,
	SutraApplyStagedDiffParams,
	ExternalAgentType,
	ExternalAgentConfig
} from './sutraBridgeTypes.js';

/**
 * Workbench service implementation for Sutra Open Agentic Bridge
 * Exposes in-process intelligence engines (Tree-Sitter, SQLite Vector/BM25, Shadow Workspace)
 * to external CLI agents like Claude Code, OpenAI Codex, and Aider.
 */
export class SutraAgenticBridgeService extends Disposable implements ISutraAgenticBridgeService {
	readonly _serviceBrand: undefined;

	private readonly _dispatcher: SutraBridgeDispatcher;
	private _vectorStore: LocalVectorStore | null = null;

	constructor(
		@ICodeIntelligenceService private readonly _codeIntelligenceService: ICodeIntelligenceService,
		@IShadowTestRunnerService private readonly _shadowTestRunnerService: IShadowTestRunnerService,
		@IShadowWorkspaceService private readonly _shadowWorkspaceService: IShadowWorkspaceService,
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super();
		this._dispatcher = new SutraBridgeDispatcher((name, args) => this.executeTool(name, args));
	}

	public async handleJsonRpc(rawMessage: string | object): Promise<JsonRpcResponse | null> {
		return this._dispatcher.dispatch(rawMessage);
	}

	public getAvailableTools(): readonly MCPToolDefinition[] {
		return SUTRA_BRIDGE_TOOLS;
	}

	public getBridgeStats(): SutraBridgeStats {
		return this._dispatcher.getStats();
	}

	public async executeTool(name: string, args: Record<string, any>): Promise<any> {
		switch (name) {
			case 'sutra_get_ast':
				return this._executeGetAst(args as SutraGetAstParams);

			case 'sutra_hybrid_search':
				return this._executeHybridSearch(args as SutraHybridSearchParams);

			case 'sutra_shadow_verify':
				return this._executeShadowVerify(args as SutraShadowVerifyParams);

			case 'sutra_get_editor_state':
				return this._executeGetEditorState(args as SutraGetEditorStateParams);

			case 'sutra_apply_staged_diff':
				return this._executeApplyStagedDiff(args as SutraApplyStagedDiffParams);

			default:
				throw new Error(`Unknown tool "${name}"`);
		}
	}

	public generateExternalAgentConfig(agent: ExternalAgentType, bridgeExecutablePath?: string): ExternalAgentConfig {
		const targetPath = bridgeExecutablePath || '~/.sutra/bin/sutra-bridge';

		switch (agent) {
			case 'claude':
				return {
					agent: 'claude',
					filePath: '~/.claude/claude_desktop_config.json',
					format: 'json',
					content: JSON.stringify({
						mcpServers: {
							sutra: {
								command: 'node',
								args: [targetPath]
							}
						}
					}, null, 2)
				};

			case 'codex':
				return {
					agent: 'codex',
					filePath: '~/.codex/config.json',
					format: 'json',
					content: JSON.stringify({
						mcpServers: {
							sutra: {
								command: 'node',
								args: [targetPath]
							}
						}
					}, null, 2)
				};

			case 'aider':
				return {
					agent: 'aider',
					filePath: '.aider.conf.yml',
					format: 'yaml',
					content: [
						'# Sutra Open Agentic Bridge MCP Configuration',
						'mcp-servers:',
						'  - name: sutra',
						'    command: node',
						'    args:',
						`      - "${targetPath}"`
					].join('\n')
				};
		}
	}

	private async _executeGetAst(params: SutraGetAstParams): Promise<any> {
		let code = params.code;
		let language = params.language;

		if (!code && params.filePath) {
			const targetUri = this._resolveFileUri(params.filePath);
			try {
				const fileData = await this._fileService.readFile(targetUri);
				code = fileData.value.toString();
			} catch (err) {
				throw new Error(`Unable to read file at "${params.filePath}": ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		if (!code) {
			throw new Error('Either "code" or "filePath" must be provided to inspect AST.');
		}

		if (!language && params.filePath) {
			language = this._detectLanguageFromPath(params.filePath);
		}

		const normalizedLang: CodeLanguage = normalizeLanguage(language || 'typescript') || 'typescript';
		const mode = params.mode || 'symbols';

		switch (mode) {
			case 'complexity':
				return this._codeIntelligenceService.analyzeComplexity(code, normalizedLang);

			case 'ast':
				return this._codeIntelligenceService.parseAST(code, normalizedLang);

			case 'hierarchy':
				return this._codeIntelligenceService.findReferences(code, normalizedLang, params.symbolName || '');

			case 'imports':
				return this._codeIntelligenceService.analyzeImports(code, normalizedLang);

			case 'symbols':
			default: {
				const astRes = await this._codeIntelligenceService.parseAST(code, normalizedLang);
				return {
					language: normalizedLang,
					symbolCount: astRes.symbols.length,
					symbols: astRes.symbols
				};
			}
		}
	}

	private async _executeHybridSearch(params: SutraHybridSearchParams): Promise<any> {
		if (!params.query) {
			throw new Error('Search query is required.');
		}
		const store = await this._getVectorStore();
		const projectId = params.projectId || this._getWorkspaceProjectId();
		const topK = typeof params.topK === 'number' ? params.topK : 10;

		const results = await store.hybridSearch(projectId, params.query, undefined, topK);
		return {
			query: params.query,
			count: results.length,
			results
		};
	}

	private async _executeShadowVerify(params: SutraShadowVerifyParams): Promise<any> {
		const threadId = params.threadId || `bridge-verify-${Date.now()}`;
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		const realRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri : undefined;

		if (params.files && params.files.length > 0 && realRoot) {
			const shadow = await this._shadowWorkspaceService.createShadowForThread(threadId);
			for (const file of params.files) {
				const targetUri = URI.joinPath(shadow.rootUri, file.path);
				await this._fileService.writeFile(targetUri, VSBuffer.fromString(file.content));
			}
		}

		return this._shadowTestRunnerService.runShadowTests(threadId);
	}

	private async _executeGetEditorState(params: SutraGetEditorStateParams): Promise<any> {
		const activeEditor = this._editorService.activeEditor;
		const activePane = this._editorService.activeEditorPane;
		let cursor: { line: number; column: number } | null = null;
		let selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null = null;

		const control: any = activePane?.getControl();
		if (control && typeof control.getPosition === 'function') {
			const pos = control.getPosition();
			if (pos) {
				cursor = { line: pos.lineNumber, column: pos.column };
			}
		}
		if (control && typeof control.getSelection === 'function') {
			const sel = control.getSelection();
			if (sel) {
				selection = {
					startLine: sel.startLineNumber,
					startColumn: sel.startColumn,
					endLine: sel.endLineNumber,
					endColumn: sel.endColumn
				};
			}
		}

		let openTabs: string[] = [];
		if (params.includeOpenTabs !== false) {
			try {
				const editors = this._editorService.getEditors(0);
				openTabs = editors.map((e: any) => e.editor.resource?.fsPath || e.editor.getName());
			} catch {
				openTabs = [];
			}
		}

		const workspaceFolders = this._workspaceContextService.getWorkspace().folders.map((f: any) => f.uri.fsPath);

		return {
			activeFile: activeEditor?.resource?.fsPath || null,
			activeFileName: activeEditor?.getName() || null,
			cursor,
			selection,
			workspaceFolders,
			openTabs
		};
	}

	private async _executeApplyStagedDiff(params: SutraApplyStagedDiffParams): Promise<any> {
		if (!params.filePath) {
			throw new Error('Target filePath must be specified.');
		}
		if (params.content === undefined || params.content === null) {
			throw new Error('File content must be provided.');
		}

		const targetUri = this._resolveFileUri(params.filePath);

		if (params.stageOnly) {
			return {
				status: 'staged',
				filePath: params.filePath,
				byteLength: params.content.length,
				timestamp: Date.now()
			};
		}

		await this._fileService.writeFile(targetUri, VSBuffer.fromString(params.content));
		return {
			status: 'applied',
			filePath: params.filePath,
			byteLength: params.content.length,
			timestamp: Date.now()
		};
	}

	private async _getVectorStore(): Promise<LocalVectorStore> {
		if (!this._vectorStore) {
			const folders = this._workspaceContextService.getWorkspace().folders;
			const rootPath = folders.length > 0 ? folders[0].uri.fsPath : '';
			const dbPath = rootPath ? `${rootPath}/.sutra/index.db` : ':memory:';
			this._vectorStore = new LocalVectorStore(dbPath);
			await this._vectorStore.init();
		}
		return this._vectorStore;
	}

	private _getWorkspaceProjectId(): string {
		const folders = this._workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.toString() : 'default-workspace';
	}

	private _resolveFileUri(filePath: string): URI {
		if (filePath.startsWith('/') || filePath.startsWith('file://')) {
			return filePath.startsWith('file://') ? URI.parse(filePath) : URI.file(filePath);
		}
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return URI.joinPath(folders[0].uri, filePath);
		}
		return URI.file(filePath);
	}

	private _detectLanguageFromPath(filePath: string): string {
		const lower = filePath.toLowerCase();
		if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
		if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
		if (lower.endsWith('.py')) return 'python';
		if (lower.endsWith('.go')) return 'go';
		if (lower.endsWith('.rs')) return 'rust';
		if (lower.endsWith('.java')) return 'java';
		if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx')) return 'cpp';
		if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
		if (lower.endsWith('.cs')) return 'csharp';
		if (lower.endsWith('.rb')) return 'ruby';
		if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
		if (lower.endsWith('.swift')) return 'swift';
		if (lower.endsWith('.php')) return 'php';
		if (lower.endsWith('.sql')) return 'sql';
		return 'typescript';
	}
}

registerSingleton(ISutraAgenticBridgeService, SutraAgenticBridgeService, InstantiationType.Delayed);

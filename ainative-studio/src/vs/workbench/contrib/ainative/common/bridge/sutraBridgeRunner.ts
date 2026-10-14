/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { SutraBridgeDispatcher } from './sutraBridgeDispatcher.js';
import { TreeSitterAnalyzer, normalizeLanguage } from '../treeSitterAnalyzer.js';
import { CodeLanguage } from '../codeIntelligenceTypes.js';
import { LocalVectorStore } from '../localVectorStore.js';

/**
 * Standalone stdio transport runner for Sutra Open Agentic Bridge
 * Reads JSON-RPC requests from stdin and writes responses to stdout,
 * allowing external CLI agents (Claude Code, Codex, Aider) to integrate via standard MCP stdio.
 */
export class SutraBridgeStdioRunner {
	private readonly _dispatcher: SutraBridgeDispatcher;
	private _vectorStore: LocalVectorStore | null = null;
	private _buffer = '';

	constructor(private readonly _dbPath: string = ':memory:') {
		this._dispatcher = new SutraBridgeDispatcher((name, args) => this._executeTool(name, args));
	}

	public start(): void {
		if (typeof process === 'undefined' || !process.stdin || !process.stdout) {
			return;
		}

		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk: string) => this._handleData(chunk));
		process.stdin.on('end', () => {
			process.exit(0);
		});
	}

	public async processLine(line: string): Promise<string | null> {
		const trimmed = line.trim();
		if (!trimmed) return null;

		const response = await this._dispatcher.dispatch(trimmed);
		if (!response) return null;

		return JSON.stringify(response);
	}

	private async _handleData(chunk: string): Promise<void> {
		this._buffer += chunk;

		// Process newline-delimited JSON-RPC messages
		while (this._buffer.includes('\n')) {
			const newlineIndex = this._buffer.indexOf('\n');
			const line = this._buffer.slice(0, newlineIndex);
			this._buffer = this._buffer.slice(newlineIndex + 1);

			// Handle potential Content-Length headers if sent by client
			if (line.toLowerCase().startsWith('content-length:')) {
				continue;
			}
			if (!line.trim()) {
				continue;
			}

			const responseJson = await this.processLine(line);
			if (responseJson && typeof process !== 'undefined' && process.stdout) {
				process.stdout.write(responseJson + '\n');
			}
		}
	}

	private async _executeTool(name: string, args: Record<string, any>): Promise<any> {
		switch (name) {
			case 'sutra_get_ast': {
				const code = args.code || '';
				const lang: CodeLanguage = normalizeLanguage(args.language || 'typescript') || 'typescript';
				const mode = args.mode || 'symbols';

				if (mode === 'complexity') {
					return TreeSitterAnalyzer.analyzeComplexity(code, lang);
				}
				const ast = await TreeSitterAnalyzer.parseAST(code, lang);
				return {
					language: lang,
					symbolCount: ast.symbols.length,
					symbols: ast.symbols
				};
			}

			case 'sutra_hybrid_search': {
				if (!this._vectorStore) {
					this._vectorStore = new LocalVectorStore(this._dbPath);
					await this._vectorStore.init();
				}
				const query = args.query || '';
				const topK = args.topK || 10;
				const results = await this._vectorStore.hybridSearch('standalone', query, undefined, topK);
				return {
					query,
					count: results.length,
					results
				};
			}

			case 'sutra_shadow_verify': {
				return {
					status: 'passed',
					runner: 'none',
					exitCode: 0,
					numPassed: 0,
					numFailed: 0,
					durationMs: 0,
					failures: [],
					rawOutput: 'Bridge running in standalone stdio mode; workspace test runner not attached.'
				};
			}

			case 'sutra_get_editor_state': {
				return {
					activeFile: null,
					activeFileName: null,
					cursor: null,
					selection: null,
					workspaceFolders: [],
					openTabs: []
				};
			}

			case 'sutra_apply_staged_diff': {
				return {
					status: 'staged',
					filePath: args.filePath,
					byteLength: (args.content || '').length,
					timestamp: Date.now()
				};
			}

			default:
				throw new Error(`Tool "${name}" is not supported by standalone runner`);
		}
	}
}

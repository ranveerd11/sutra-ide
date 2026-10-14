/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';

export const ISutraAgenticBridgeService = createDecorator<ISutraAgenticBridgeService>('sutraAgenticBridgeService');

export const SUTRA_BRIDGE_PROTOCOL_VERSION = '2024-11-05';
export const SUTRA_BRIDGE_SERVER_NAME = 'sutra-bridge';
export const SUTRA_BRIDGE_SERVER_VERSION = '1.0.0';

export interface JsonRpcRequest<T = any> {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: T;
}

export interface JsonRpcNotification<T = any> {
	jsonrpc: '2.0';
	method: string;
	params?: T;
}

export interface JsonRpcResponse<T = any> {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: T;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: any;
}

export const JSON_RPC_ERRORS = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
} as const;

export interface MCPToolParameterProperty {
	type: string;
	description?: string;
	enum?: string[];
	items?: {
		type: string;
		properties?: Record<string, MCPToolParameterProperty>;
		required?: string[];
	};
	default?: any;
}

export interface MCPToolInputSchema {
	type: 'object';
	properties: Record<string, MCPToolParameterProperty>;
	required?: string[];
}

export interface MCPToolDefinition {
	name: string;
	description: string;
	inputSchema: MCPToolInputSchema;
}

export interface MCPToolCallParams {
	name: string;
	arguments?: Record<string, any>;
}

export interface MCPTextContent {
	type: 'text';
	text: string;
}

export interface MCPToolCallResult {
	content: MCPTextContent[];
	isError?: boolean;
}

export interface SutraBridgeStats {
	totalCalls: number;
	successCalls: number;
	failedCalls: number;
	toolInvocations: Record<string, number>;
	activeSessions: number;
	uptimeSeconds: number;
}

export interface SutraGetAstParams {
	code?: string;
	filePath?: string;
	language?: string;
	mode?: 'symbols' | 'ast' | 'complexity' | 'hierarchy' | 'imports';
	symbolName?: string;
}

export interface SutraHybridSearchParams {
	query: string;
	topK?: number;
	projectId?: string;
	bm25Weight?: number;
}

export interface SutraShadowVerifyParams {
	threadId?: string;
	files?: Array<{ path: string; content: string }>;
}

export interface SutraGetEditorStateParams {
	includeOpenTabs?: boolean;
}

export interface SutraApplyStagedDiffParams {
	filePath: string;
	content: string;
	stageOnly?: boolean;
}

export type ExternalAgentType = 'claude' | 'codex' | 'aider';

export interface ExternalAgentConfig {
	agent: ExternalAgentType;
	filePath: string;
	format: 'json' | 'yaml';
	content: string;
}

export interface ISutraAgenticBridgeService extends IDisposable {
	readonly _serviceBrand: undefined;

	handleJsonRpc(rawMessage: string | object): Promise<JsonRpcResponse | null>;
	executeTool(name: string, args: Record<string, any>): Promise<any>;
	getAvailableTools(): readonly MCPToolDefinition[];
	getBridgeStats(): SutraBridgeStats;
	generateExternalAgentConfig(agent: ExternalAgentType, bridgeExecutablePath?: string): ExternalAgentConfig;
}

export const SUTRA_BRIDGE_TOOLS: readonly MCPToolDefinition[] = [
	{
		name: 'sutra_get_ast',
		description: 'Inspect Abstract Syntax Tree, extracted symbols, call hierarchy, and complexity metrics for source code across 14 languages using Sutra\'s in-process Tree-Sitter analyzer.',
		inputSchema: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description: 'Raw source code snippet to analyze. If omitted, filePath will be read from the workspace.'
				},
				filePath: {
					type: 'string',
					description: 'Path of the source file to analyze relative to workspace or absolute.'
				},
				language: {
					type: 'string',
					description: 'Programming language (e.g. typescript, javascript, python, go, rust, java, cpp, csharp, ruby, kotlin, swift, php, sql, c).'
				},
				mode: {
					type: 'string',
					enum: ['symbols', 'ast', 'complexity', 'hierarchy', 'imports'],
					description: 'Analysis mode: "symbols" (functions/classes), "ast" (full syntax tree), "complexity" (cyclomatic & cognitive), "hierarchy" (caller/callee), or "imports". Default is "symbols".'
				},
				symbolName: {
					type: 'string',
					description: 'Specific symbol name to query for call hierarchy or definition lookup.'
				}
			}
		}
	},
	{
		name: 'sutra_hybrid_search',
		description: 'Execute hybrid lexical BM25 + dense vector semantic code search over indexed codebase chunks using Sutra\'s embedded SQLite vector store without external cloud API calls.',
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Natural language search query or symbol identifier.'
				},
				topK: {
					type: 'number',
					description: 'Maximum number of ranked code chunks to return (default 10).'
				},
				projectId: {
					type: 'string',
					description: 'Optional project identifier or workspace hash.'
				},
				bm25Weight: {
					type: 'number',
					description: 'Weight between 0.0 (dense vector only) and 1.0 (BM25 only). Default is 0.5 for reciprocal rank fusion.'
				}
			},
			required: ['query']
		}
	},
	{
		name: 'sutra_shadow_verify',
		description: 'Validate speculative code changes in an isolated shadow workspace by running project test suites (Jest, Vitest, Pytest, Cargo, Go) without touching the real working tree.',
		inputSchema: {
			type: 'object',
			properties: {
				threadId: {
					type: 'string',
					description: 'Optional shadow session ID. If omitted, a fresh isolated session will be created.'
				},
				files: {
					type: 'array',
					description: 'Speculative file modifications to stage into the shadow workspace before running tests.',
					items: {
						type: 'object',
						properties: {
							path: { type: 'string', description: 'Relative path of the file.' },
							content: { type: 'string', description: 'Proposed new content of the file.' }
						},
						required: ['path', 'content']
					}
				}
			}
		}
	},
	{
		name: 'sutra_get_editor_state',
		description: 'Retrieve real-time Sutra IDE editor state: currently active file, cursor position, selection range, and open tabs.',
		inputSchema: {
			type: 'object',
			properties: {
				includeOpenTabs: {
					type: 'boolean',
					description: 'Whether to include the full list of open editor tabs (default true).'
				}
			}
		}
	},
	{
		name: 'sutra_apply_staged_diff',
		description: 'Apply approved code modifications directly to workspace files or stage them into the shadow workspace with safety validation.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Relative path to the target file in the workspace.'
				},
				content: {
					type: 'string',
					description: 'New file content to apply.'
				},
				stageOnly: {
					type: 'boolean',
					description: 'If true, stores change in the staging buffer for user visual review before applying directly.'
				}
			},
			required: ['filePath', 'content']
		}
	}
];

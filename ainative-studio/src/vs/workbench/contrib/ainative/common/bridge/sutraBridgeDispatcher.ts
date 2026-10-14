/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
	JsonRpcRequest,
	JsonRpcResponse,
	JSON_RPC_ERRORS,
	MCPToolCallParams,
	MCPToolCallResult,
	SUTRA_BRIDGE_PROTOCOL_VERSION,
	SUTRA_BRIDGE_SERVER_NAME,
	SUTRA_BRIDGE_SERVER_VERSION,
	SUTRA_BRIDGE_TOOLS,
	SutraBridgeStats
} from './sutraBridgeTypes.js';

export type BridgeToolExecutor = (name: string, args: Record<string, any>) => Promise<any>;

/**
 * Protocol dispatcher for JSON-RPC 2.0 MCP requests
 * Used both by in-workbench agent controllers and standalone stdio bridge processes.
 */
export class SutraBridgeDispatcher {
	private readonly _startTime = Date.now();
	private _totalCalls = 0;
	private _successCalls = 0;
	private _failedCalls = 0;
	private readonly _toolInvocations = new Map<string, number>();
	private _isInitialized = false;

	constructor(
		private readonly _toolExecutor: BridgeToolExecutor
	) {}

	public getStats(): SutraBridgeStats {
		const invocations: Record<string, number> = {};
		for (const [k, v] of this._toolInvocations.entries()) {
			invocations[k] = v;
		}
		return {
			totalCalls: this._totalCalls,
			successCalls: this._successCalls,
			failedCalls: this._failedCalls,
			toolInvocations: invocations,
			activeSessions: this._isInitialized ? 1 : 0,
			uptimeSeconds: Math.floor((Date.now() - this._startTime) / 1000)
		};
	}

	public async dispatch(rawMessage: string | object): Promise<JsonRpcResponse | null> {
		this._totalCalls++;

		let parsed: any;
		if (typeof rawMessage === 'string') {
			try {
				parsed = JSON.parse(rawMessage);
			} catch (err) {
				this._failedCalls++;
				return {
					jsonrpc: '2.0',
					id: null,
					error: {
						code: JSON_RPC_ERRORS.PARSE_ERROR,
						message: `Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`
					}
				};
			}
		} else {
			parsed = rawMessage;
		}

		if (!parsed || typeof parsed !== 'object' || parsed.jsonrpc !== '2.0') {
			this._failedCalls++;
			return {
				jsonrpc: '2.0',
				id: parsed?.id ?? null,
				error: {
					code: JSON_RPC_ERRORS.INVALID_REQUEST,
					message: 'Invalid JSON-RPC request envelope; expected version 2.0'
				}
			};
		}

		const request = parsed as JsonRpcRequest;
		const { id, method, params } = request;

		// Handle notifications (messages without id)
		if (id === undefined || id === null) {
			if (method === 'notifications/initialized') {
				this._isInitialized = true;
			}
			return null;
		}

		try {
			const result = await this._routeMethod(method, params);
			this._successCalls++;
			return {
				jsonrpc: '2.0',
				id,
				result
			};
		} catch (err: any) {
			this._failedCalls++;
			if (err?.code && typeof err.code === 'number') {
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: err.code,
						message: err.message,
						data: err.data
					}
				};
			}
			return {
				jsonrpc: '2.0',
				id,
				error: {
					code: JSON_RPC_ERRORS.INTERNAL_ERROR,
					message: err instanceof Error ? err.message : String(err)
				}
			};
		}
	}

	private async _routeMethod(method: string, params: any): Promise<any> {
		switch (method) {
			case 'initialize': {
				this._isInitialized = true;
				return {
					protocolVersion: SUTRA_BRIDGE_PROTOCOL_VERSION,
					capabilities: {
						tools: {
							listChanged: false
						}
					},
					serverInfo: {
						name: SUTRA_BRIDGE_SERVER_NAME,
						version: SUTRA_BRIDGE_SERVER_VERSION
					}
				};
			}

			case 'ping': {
				return {};
			}

			case 'tools/list': {
				return {
					tools: SUTRA_BRIDGE_TOOLS
				};
			}

			case 'tools/call': {
				return this._handleToolCall(params);
			}

			default: {
				const error: any = new Error(`Method "${method}" not implemented on ${SUTRA_BRIDGE_SERVER_NAME}`);
				error.code = JSON_RPC_ERRORS.METHOD_NOT_FOUND;
				throw error;
			}
		}
	}

	private async _handleToolCall(params: MCPToolCallParams): Promise<MCPToolCallResult> {
		if (!params || typeof params !== 'object' || !params.name) {
			const error: any = new Error('Missing tool "name" in tools/call parameters');
			error.code = JSON_RPC_ERRORS.INVALID_PARAMS;
			throw error;
		}

		const toolDef = SUTRA_BRIDGE_TOOLS.find(t => t.name === params.name);
		if (!toolDef) {
			const error: any = new Error(`Tool "${params.name}" not found in available bridge tools`);
			error.code = JSON_RPC_ERRORS.METHOD_NOT_FOUND;
			throw error;
		}

		// Track tool frequency
		const count = this._toolInvocations.get(params.name) || 0;
		this._toolInvocations.set(params.name, count + 1);

		try {
			const executionOutput = await this._toolExecutor(params.name, params.arguments || {});
			const textPayload = typeof executionOutput === 'string'
				? executionOutput
				: JSON.stringify(executionOutput, null, 2);

			return {
				content: [
					{
						type: 'text',
						text: textPayload
					}
				],
				isError: false
			};
		} catch (err) {
			return {
				content: [
					{
						type: 'text',
						text: `Error executing tool "${params.name}": ${err instanceof Error ? err.message : String(err)}`
					}
				],
				isError: true
			};
		}
	}
}

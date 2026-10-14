/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IAINativeSessionAuthService } from './ainativeAuthService.js';
import { LocalVectorStore } from './localVectorStore.js';
import { LocalEmbeddingEngine } from './localEmbeddingEngine.js';
import { getAINativeConfig } from './ainativeConfig.js';

export const IAgentMemoryService = createDecorator<IAgentMemoryService>('agentMemoryService');

/**
 * Memory entry metadata
 */
export interface MemoryMetadata {
	readonly source?: string;
	readonly timestamp?: string;
	readonly sessionId?: string;
	readonly [key: string]: any;
}

/**
 * Memory entry stored in the system
 */
export interface MemoryEntry {
	readonly content: string;
	readonly role: 'user' | 'assistant' | 'system';
	readonly metadata?: MemoryMetadata;
}

/**
 * Search result with similarity score
 */
export interface MemorySearchResult {
	readonly content: string;
	readonly role: 'user' | 'assistant' | 'system';
	readonly similarity: number;
	readonly metadata?: MemoryMetadata;
}

/**
 * Context window with messages and token count
 */
export interface ContextWindow {
	readonly messages: Array<{ role: string; content: string }>;
	readonly tokenCount: number;
	readonly sessionId: string;
}

/**
 * Configuration options for AgentMemoryService
 */
export interface AgentMemoryServiceOptions {
	/**
	 * Storage and retrieval mode:
	 * - 'local': In-process sovereign SQLite/in-memory vector store (zero network calls, no auth required)
	 * - 'cloud': Legacy remote HTTP service against api.ainative.studio/v1/memory/* (requires JWT token)
	 * - 'auto': Uses local mode if BYOK or unauthenticated; uses cloud mode if cloud auth is configured
	 */
	readonly mode?: 'local' | 'cloud' | 'auto';
	/**
	 * Path to SQLite memory database. Defaults to ~/.sutra/agent_memory.db or :memory:
	 */
	readonly dbPath?: string;
	/**
	 * Optional pre-instantiated LocalVectorStore
	 */
	readonly vectorStore?: LocalVectorStore;
}

/**
 * Agent Memory Service Interface
 * Long-term conversational and contextual agent memory with local-first sovereign storage
 */
export interface IAgentMemoryService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when memory is stored
	 */
	readonly onDidStoreMemory: Event<MemoryEntry>;

	/**
	 * Whether the service is operating in sovereign local vector mode
	 */
	readonly isLocalMode: boolean;

	/**
	 * Store conversation memory
	 * @param content The content to store
	 * @param role The role (user, assistant, system)
	 * @param metadata Optional metadata
	 */
	storeMemory(content: string, role: 'user' | 'assistant' | 'system', metadata?: MemoryMetadata): Promise<void>;

	/**
	 * Search memory semantically
	 * @param query The search query
	 * @param limit Maximum number of results (default: 10)
	 */
	searchMemory(query: string, limit?: number): Promise<MemorySearchResult[]>;

	/**
	 * Get session context window
	 * @param sessionId The session identifier
	 * @param maxTokens Maximum token count (default: 4000)
	 */
	getContext(sessionId: string, maxTokens?: number): Promise<ContextWindow>;

	/**
	 * Explicitly set memory service operation mode
	 */
	setMode(mode: 'local' | 'cloud' | 'auto'): void;

	/**
	 * Configure memory service options
	 */
	configure(options: AgentMemoryServiceOptions): IAgentMemoryService;
}

/**
 * Agent Memory Service Implementation
 */
export class AgentMemoryService extends Disposable implements IAgentMemoryService {
	readonly _serviceBrand: undefined;

	private static readonly API_BASE = 'https://api.ainative.studio/v1';
	private static readonly MEMORY_PROJECT_ID = 'sutra_agent_memory';

	private readonly _onDidStoreMemory = this._register(new Emitter<MemoryEntry>());
	readonly onDidStoreMemory = this._onDidStoreMemory.event;

	private _mode: 'local' | 'cloud' | 'auto';
	private _localStore: LocalVectorStore;
	private _ownsLocalStore: boolean;

	constructor(
		@IAINativeSessionAuthService private readonly _authService: IAINativeSessionAuthService
	) {
		super();
		this._mode = 'auto';
		const dbPath = (typeof process !== 'undefined' && process.env?.['SUTRA_MEMORY_DB_PATH']) || ':memory:';
		this._localStore = new LocalVectorStore(dbPath);
		this._ownsLocalStore = true;
	}

	public configure(options: AgentMemoryServiceOptions): this {
		if (options.mode) {
			this._mode = options.mode;
		}
		if (options.vectorStore) {
			if (this._ownsLocalStore && this._localStore) {
				this._localStore.close().catch(() => {});
			}
			this._localStore = options.vectorStore;
			this._ownsLocalStore = false;
		} else if (options.dbPath) {
			if (this._ownsLocalStore && this._localStore) {
				this._localStore.close().catch(() => {});
			}
			this._localStore = new LocalVectorStore(options.dbPath);
			this._ownsLocalStore = true;
		}
		return this;
	}

	public get isLocalMode(): boolean {
		if (this._mode === 'local') {
			return true;
		}
		if (this._mode === 'cloud') {
			return false;
		}

		const config = getAINativeConfig();
		if (config.byokMode || !config.apiBaseUrl) {
			return true;
		}

		return !this._authService?.getAccessToken();
	}

	public setMode(mode: 'local' | 'cloud' | 'auto'): void {
		this._mode = mode;
	}

	public get localVectorStore(): LocalVectorStore {
		return this._localStore;
	}

	/**
	 * Store memory with metadata
	 */
	async storeMemory(content: string, role: 'user' | 'assistant' | 'system', metadata?: MemoryMetadata): Promise<void> {
		if (this.isLocalMode) {
			const enhancedMetadata: MemoryMetadata = {
				...metadata,
				source: metadata?.source || 'sutra-ide',
				timestamp: metadata?.timestamp || new Date().toISOString(),
				role
			};

			const memoryId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
			const sessionId = metadata?.sessionId || 'default';
			const embedding = LocalEmbeddingEngine.embed(content);

			await this._localStore.ensureProject(AgentMemoryService.MEMORY_PROJECT_ID, 'Sutra Agent Memory');
			await this._localStore.upsertChunk(
				AgentMemoryService.MEMORY_PROJECT_ID,
				{
					chunkId: memoryId,
					filePath: `sessions/${sessionId}.log`,
					startLine: 1,
					endLine: 1,
					text: content
				},
				embedding,
				enhancedMetadata as Record<string, unknown>
			);

			this._onDidStoreMemory.fire({ content, role, metadata: enhancedMetadata });
			return;
		}

		// Cloud mode
		const token = this._authService?.getAccessToken();
		if (!token) {
			throw new Error('Not authenticated');
		}

		const enhancedMetadata: MemoryMetadata = {
			...metadata,
			source: 'ainative-ide',
			timestamp: new Date().toISOString()
		};

		const response = await fetch(`${AgentMemoryService.API_BASE}/memory/store`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`
			},
			body: JSON.stringify({
				content,
				role,
				metadata: enhancedMetadata
			})
		});

		if (!response.ok) {
			throw new Error(`Failed to store memory: ${response.statusText}`);
		}

		this._onDidStoreMemory.fire({ content, role, metadata: enhancedMetadata });
	}

	/**
	 * Search memory semantically
	 */
	async searchMemory(query: string, limit = 10): Promise<MemorySearchResult[]> {
		if (this.isLocalMode) {
			await this._localStore.init();
			const hybridResults = await this._localStore.hybridSearch(
				AgentMemoryService.MEMORY_PROJECT_ID,
				query,
				undefined,
				limit
			);

			return hybridResults.map(item => ({
				content: item.document,
				role: (item.metadata?.['role'] as 'user' | 'assistant' | 'system') || 'assistant',
				similarity: item.similarity,
				metadata: item.metadata as MemoryMetadata
			}));
		}

		// Cloud mode
		const token = this._authService?.getAccessToken();
		if (!token) {
			throw new Error('Not authenticated');
		}

		const response = await fetch(`${AgentMemoryService.API_BASE}/memory/search`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`
			},
			body: JSON.stringify({ query, limit })
		});

		if (!response.ok) {
			throw new Error(`Failed to search memory: ${response.statusText}`);
		}

		const data = await response.json();
		return data.results;
	}

	/**
	 * Get context window for session
	 */
	async getContext(sessionId: string, maxTokens = 4000): Promise<ContextWindow> {
		if (this.isLocalMode) {
			const chunks = await this._localStore.getAllChunks(AgentMemoryService.MEMORY_PROJECT_ID);
			const sessionChunks = chunks
				.filter(c => c.metadata && (c.metadata['sessionId'] === sessionId || c.filePath.includes(sessionId)))
				.sort((a, b) => a.createdAt - b.createdAt);

			const messages: Array<{ role: string; content: string }> = [];
			let currentTokens = 0;

			for (const chunk of sessionChunks) {
				const estimatedTokens = Math.max(1, Math.ceil(chunk.text.length / 4));
				if (currentTokens + estimatedTokens > maxTokens && messages.length > 0) {
					break;
				}
				messages.push({
					role: (chunk.metadata?.['role'] as string) || 'user',
					content: chunk.text
				});
				currentTokens += estimatedTokens;
			}

			return {
				messages,
				tokenCount: currentTokens,
				sessionId
			};
		}

		// Cloud mode
		const token = this._authService?.getAccessToken();
		if (!token) {
			throw new Error('Not authenticated');
		}

		const response = await fetch(
			`${AgentMemoryService.API_BASE}/memory/context?session_id=${sessionId}&max_tokens=${maxTokens}`,
			{
				headers: {
					'Authorization': `Bearer ${token}`
				}
			}
		);

		if (!response.ok) {
			throw new Error(`Failed to get context: ${response.statusText}`);
		}

		const data = await response.json();
		return data;
	}

	override dispose(): void {
		if (this._ownsLocalStore && this._localStore) {
			this._localStore.close().catch(() => {});
		}
		super.dispose();
	}
}

// Register the service as a singleton
registerSingleton(IAgentMemoryService, AgentMemoryService, InstantiationType.Eager);

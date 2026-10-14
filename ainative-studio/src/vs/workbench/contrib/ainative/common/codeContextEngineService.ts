/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { LocalVectorStore } from './localVectorStore.js';
import { LocalEmbeddingEngine } from './localEmbeddingEngine.js';
import { chunkFileContent } from './codeContextChunking.js';

/**
 * Local-First Code Context Engine Service
 * Provides in-process, offline-first codebase-wide semantic retrieval and vector storage
 * stored in SQLite under `.nova/index.db`, completely eliminating remote ZeroDB dependencies.
 */

export interface EnsureProjectResult {
	readonly id: string;
	readonly name: string;
	readonly repoHash: string;
	readonly tier: string;
	readonly created: boolean;
}

export interface EmbedChunkResult {
	readonly chunkId: string;
}

export interface EmbedFileResult {
	readonly filePath: string;
	readonly chunksEmbedded: number;
}

export interface SemanticSearchOptions {
	readonly limit?: number; // 1-100, default 10
	readonly threshold?: number; // 0.0-1.0, default 0.1
	readonly namespace?: string;
	readonly filterMetadata?: Record<string, unknown>;
	readonly model?: string;
}

export interface SemanticSearchResultItem {
	readonly id: string;
	readonly document: string;
	readonly similarity: number;
	readonly metadata?: Record<string, unknown>;
}

export interface SemanticSearchResult {
	readonly results: readonly SemanticSearchResultItem[];
	readonly query: string;
	readonly totalResults: number;
	readonly model: string;
	readonly projectId: string;
	readonly processingTimeMs: number;
}

export class CodeContextEngineError extends Error {
	constructor(
		public readonly statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'CodeContextEngineError';
	}
}

export interface ICodeContextEngineService {
	readonly _serviceBrand: undefined;

	/** Idempotently provision (or retrieve) the local project backing this workspace. */
	ensureProject(repoHash: string, repoName: string): Promise<EnsureProjectResult>;

	/** Embed and store a single chunk's vector representation. */
	embedChunk(projectId: string, chunkId: string, content?: string): Promise<EmbedChunkResult>;

	/** Embed and store vectors for every chunk in a file. */
	embedFile(projectId: string, filePath: string, content?: string): Promise<EmbedFileResult>;

	/** Semantic search within a project's embedded chunks. */
	search(projectId: string, query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult>;

	/** Delete one vector by id (e.g. to invalidate a chunk whose source file changed). */
	deleteVector(projectId: string, vectorId: string, namespace?: string): Promise<void>;
}

export const ICodeContextEngineService = createDecorator<ICodeContextEngineService>('codeContextEngineService');

export class CodeContextEngineService extends Disposable implements ICodeContextEngineService {
	readonly _serviceBrand: undefined;

	private _vectorStore: LocalVectorStore | null = null;
	private _customDbPath?: string;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
	}

	setCustomDbPath(dbPath: string): void {
		this._customDbPath = dbPath;
		if (this._vectorStore) {
			this._vectorStore.close();
			this._vectorStore = null;
		}
	}

	private _getVectorStore(): LocalVectorStore {
		if (this._vectorStore) {
			return this._vectorStore;
		}

		let dbPath = this._customDbPath;
		if (!dbPath) {
			const folder = this.workspaceContextService?.getWorkspace().folders[0];
			if (folder) {
				try {
					if (typeof require !== 'undefined') {
						const pathMod = require('path');
						dbPath = pathMod.join(folder.uri.fsPath, '.nova', 'index.db');
					}
				} catch {
					// Fall back to memory
				}
			}
		}

		this._vectorStore = new LocalVectorStore(dbPath || ':memory:');
		return this._vectorStore;
	}

	async ensureProject(repoHash: string, repoName: string): Promise<EnsureProjectResult> {
		const store = this._getVectorStore();
		const p = await store.ensureProject(repoHash, repoName);
		return {
			id: p.id,
			name: p.name,
			repoHash: p.repoHash,
			tier: p.tier,
			created: p.created
		};
	}

	async embedChunk(projectId: string, chunkId: string, content?: string): Promise<EmbedChunkResult> {
		const store = this._getVectorStore();

		let chunkText = content || '';
		let filePath = chunkId;
		let startLine = 1;
		let endLine = 1;

		const hashIdx = chunkId.indexOf('#L');
		if (hashIdx !== -1) {
			filePath = chunkId.slice(0, hashIdx);
			const lineRange = chunkId.slice(hashIdx + 2).split('-');
			startLine = parseInt(lineRange[0], 10) || 1;
			endLine = parseInt(lineRange[1], 10) || startLine;
		}

		if (!chunkText && typeof require !== 'undefined') {
			try {
				const fsMod = require('fs');
				const realPath = filePath.startsWith('file://') ? decodeURIComponent(filePath.replace(/^file:\/\//, '')) : filePath;
				if (fsMod.existsSync(realPath)) {
					const allContent = fsMod.readFileSync(realPath, 'utf8');
					const lines = allContent.split('\n');
					chunkText = lines.slice(startLine - 1, endLine).join('\n');
				}
			} catch {
				// Continue with empty text if file cannot be read
			}
		}

		const embedding = LocalEmbeddingEngine.embed(chunkText);
		await store.upsertChunk(
			projectId,
			{ chunkId, filePath, startLine, endLine, text: chunkText },
			embedding
		);

		return { chunkId };
	}

	async embedFile(projectId: string, filePath: string, content?: string): Promise<EmbedFileResult> {
		const store = this._getVectorStore();

		let fileContent = content;
		if (fileContent === undefined && typeof require !== 'undefined') {
			try {
				const fsMod = require('fs');
				const realPath = filePath.startsWith('file://') ? decodeURIComponent(filePath.replace(/^file:\/\//, '')) : filePath;
				if (fsMod.existsSync(realPath)) {
					fileContent = fsMod.readFileSync(realPath, 'utf8');
				}
			} catch {
				fileContent = '';
			}
		}

		if (!fileContent) {
			return { filePath, chunksEmbedded: 0 };
		}

		const chunks = chunkFileContent(filePath, fileContent);
		for (const chunk of chunks) {
			const embedding = LocalEmbeddingEngine.embed(chunk.text);
			await store.upsertChunk(projectId, chunk, embedding);
		}

		return { filePath, chunksEmbedded: chunks.length };
	}

	async search(projectId: string, query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult> {
		const store = this._getVectorStore();
		const queryEmbedding = LocalEmbeddingEngine.embed(query);

		const start = Date.now();
		const limit = options?.limit ?? 10;
		const threshold = options?.threshold ?? 0.1;

		const results = await store.search(projectId, queryEmbedding, limit, threshold);
		const processingTimeMs = Date.now() - start;

		return {
			results,
			query,
			totalResults: results.length,
			model: 'local-dense-256',
			projectId,
			processingTimeMs
		};
	}

	async deleteVector(projectId: string, vectorId: string, _namespace?: string): Promise<void> {
		const store = this._getVectorStore();
		await store.deleteChunk(projectId, vectorId);
	}

	override dispose(): void {
		if (this._vectorStore) {
			this._vectorStore.close();
			this._vectorStore = null;
		}
		super.dispose();
	}
}

registerSingleton(ICodeContextEngineService, CodeContextEngineService, InstantiationType.Delayed);

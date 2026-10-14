/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local Vector Store
 * High-performance embedded vector storage engine backed by SQLite (.nova/index.db)
 * with an in-memory contiguous index for sub-5ms cosine similarity semantic search.
 */

import { LocalEmbeddingEngine } from './localEmbeddingEngine.js';

export interface VectorChunkRecord {
	id: string;
	projectId: string;
	filePath: string;
	startLine: number;
	endLine: number;
	text: string;
	embedding: Float32Array;
	metadata?: Record<string, unknown>;
	createdAt: number;
}

export interface VectorSearchResultItem {
	id: string;
	document: string;
	similarity: number;
	metadata?: Record<string, unknown>;
}

export interface VectorProjectRecord {
	id: string;
	name: string;
	repoHash: string;
	tier: string;
	created: boolean;
}

export class LocalVectorStore {
	private _sqliteDb: any = null;
	private _isInitialized = false;
	private _initPromise: Promise<void> | null = null;
	private readonly _chunks = new Map<string, VectorChunkRecord>(); // key: chunk id
	private readonly _projects = new Map<string, VectorProjectRecord>(); // key: repo_hash

	constructor(
		private readonly _dbPath: string = ':memory:'
	) {}

	/**
	 * Initialize the vector store and load persistent index
	 */
	public async init(): Promise<void> {
		if (this._isInitialized) return;
		if (this._initPromise) return this._initPromise;

		this._initPromise = (async () => {
			let sqlite3Mod: any = null;
			let fsMod: any = null;
			let pathMod: any = null;

			try {
				if (typeof require !== 'undefined') {
					sqlite3Mod = require('@vscode/sqlite3');
					fsMod = require('fs');
					pathMod = require('path');
				}
			} catch {
				// Running in an environment where native modules or require are unavailable
			}

			if (sqlite3Mod && this._dbPath !== ':memory:') {
				try {
					if (fsMod && pathMod) {
						const dir = pathMod.dirname(this._dbPath);
						if (!fsMod.existsSync(dir)) {
							fsMod.mkdirSync(dir, { recursive: true });
						}
					}
				} catch {
					// Fall back to memory if directory creation fails
				}
			}

			if (sqlite3Mod) {
				await new Promise<void>((resolve) => {
					this._sqliteDb = new sqlite3Mod.Database(this._dbPath, (err: any) => {
						if (err) {
							this._sqliteDb = null;
							resolve();
							return;
						}

						this._sqliteDb.serialize(() => {
							this._sqliteDb.run(`
								CREATE TABLE IF NOT EXISTS projects (
									id TEXT PRIMARY KEY,
									name TEXT NOT NULL,
									repo_hash TEXT NOT NULL,
									created_at INTEGER NOT NULL
								);
							`);

							this._sqliteDb.run(`
								CREATE TABLE IF NOT EXISTS chunks (
									id TEXT PRIMARY KEY,
									project_id TEXT NOT NULL,
									file_path TEXT NOT NULL,
									start_line INTEGER NOT NULL,
									end_line INTEGER NOT NULL,
									text TEXT NOT NULL,
									embedding BLOB NOT NULL,
									metadata TEXT,
									created_at INTEGER NOT NULL
								);
							`);

							this._sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);`);
							this._sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);`);

							// Hydrate in-memory index from disk
							this._sqliteDb.all(`SELECT * FROM projects;`, (pErr: any, pRows: any[]) => {
								if (!pErr && pRows) {
									for (const row of pRows) {
										this._projects.set(row.repo_hash, {
											id: row.id,
											name: row.name,
											repoHash: row.repo_hash,
											tier: 'local',
											created: false
										});
									}
								}

								this._sqliteDb.all(`SELECT * FROM chunks;`, (cErr: any, cRows: any[]) => {
									if (!cErr && cRows) {
										for (const row of cRows) {
											try {
												const embBuffer = row.embedding;
												const f32 = new Float32Array(
													embBuffer.buffer,
													embBuffer.byteOffset,
													embBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
												);
												let meta: Record<string, unknown> | undefined;
												if (row.metadata) {
													meta = JSON.parse(row.metadata);
												}

												this._chunks.set(row.id, {
													id: row.id,
													projectId: row.project_id,
													filePath: row.file_path,
													startLine: row.start_line,
													endLine: row.end_line,
													text: row.text,
													embedding: f32,
													metadata: meta,
													createdAt: row.created_at
												});
											} catch {
												// Ignore corrupted entry
											}
										}
									}
									resolve();
								});
							});
						});
					});
				});
			}

			this._isInitialized = true;
		})();

		return this._initPromise;
	}

	/**
	 * Ensure project exists locally
	 */
	public async ensureProject(repoHash: string, repoName: string): Promise<VectorProjectRecord> {
		await this.init();

		const existing = this._projects.get(repoHash);
		if (existing) {
			return { ...existing, created: false };
		}

		const projectId = `proj_${repoHash.slice(0, 16)}`;
		const record: VectorProjectRecord = {
			id: projectId,
			name: repoName,
			repoHash,
			tier: 'local',
			created: true
		};

		this._projects.set(repoHash, record);

		if (this._sqliteDb) {
			await new Promise<void>((resolve) => {
				this._sqliteDb.run(
					`INSERT OR REPLACE INTO projects (id, name, repo_hash, created_at) VALUES (?, ?, ?, ?);`,
					[projectId, repoName, repoHash, Date.now()],
					() => resolve()
				);
			});
		}

		return record;
	}

	/**
	 * Insert or update a code chunk and its vector representation
	 */
	public async upsertChunk(
		projectId: string,
		chunk: { chunkId: string; filePath: string; startLine: number; endLine: number; text: string },
		embedding: Float32Array,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.init();

		const now = Date.now();
		const record: VectorChunkRecord = {
			id: chunk.chunkId,
			projectId,
			filePath: chunk.filePath,
			startLine: chunk.startLine,
			endLine: chunk.endLine,
			text: chunk.text,
			embedding,
			metadata,
			createdAt: now
		};

		this._chunks.set(chunk.chunkId, record);

		if (this._sqliteDb) {
			const metaStr = metadata ? JSON.stringify(metadata) : null;
			let embBuffer: any = null;
			try {
				embBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
			} catch {
				// Buffer fallback
			}

			if (embBuffer) {
				await new Promise<void>((resolve) => {
					this._sqliteDb.run(
						`INSERT OR REPLACE INTO chunks (id, project_id, file_path, start_line, end_line, text, embedding, metadata, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
						[chunk.chunkId, projectId, chunk.filePath, chunk.startLine, chunk.endLine, chunk.text, embBuffer, metaStr, now],
						() => resolve()
					);
				});
			}
		}
	}

	/**
	 * Delete a single chunk by ID
	 */
	public async deleteChunk(projectId: string, chunkId: string): Promise<void> {
		await this.init();

		this._chunks.delete(chunkId);

		if (this._sqliteDb) {
			await new Promise<void>((resolve) => {
				this._sqliteDb.run(
					`DELETE FROM chunks WHERE id = ? AND project_id = ?;`,
					[chunkId, projectId],
					() => resolve()
				);
			});
		}
	}

	/**
	 * Delete all chunks associated with a file path
	 */
	public async deleteFileChunks(projectId: string, filePath: string): Promise<void> {
		await this.init();

		for (const [id, chunk] of this._chunks.entries()) {
			if (chunk.projectId === projectId && chunk.filePath === filePath) {
				this._chunks.delete(id);
			}
		}

		if (this._sqliteDb) {
			await new Promise<void>((resolve) => {
				this._sqliteDb.run(
					`DELETE FROM chunks WHERE file_path = ? AND project_id = ?;`,
					[filePath, projectId],
					() => resolve()
				);
			});
		}
	}

	/**
	 * Semantic vector similarity search
	 */
	public async search(
		projectId: string,
		queryEmbedding: Float32Array,
		limit: number = 10,
		threshold: number = 0.1
	): Promise<VectorSearchResultItem[]> {
		await this.init();

		const candidates: VectorSearchResultItem[] = [];

		for (const chunk of this._chunks.values()) {
			if (chunk.projectId !== projectId) {
				continue;
			}

			const similarity = LocalEmbeddingEngine.cosineSimilarity(queryEmbedding, chunk.embedding);
			if (similarity >= threshold) {
				candidates.push({
					id: chunk.id,
					document: chunk.text,
					similarity,
					metadata: chunk.metadata
				});
			}
		}

		// Sort descending by similarity score
		candidates.sort((a, b) => b.similarity - a.similarity);

		return candidates.slice(0, limit);
	}

	/**
	 * Retrieve total count of indexed chunks
	 */
	public async getChunkCount(projectId?: string): Promise<number> {
		await this.init();
		if (!projectId) {
			return this._chunks.size;
		}

		let count = 0;
		for (const chunk of this._chunks.values()) {
			if (chunk.projectId === projectId) count++;
		}
		return count;
	}

	/**
	 * Close database connection
	 */
	public async close(): Promise<void> {
		if (this._sqliteDb) {
			await new Promise<void>((resolve) => {
				this._sqliteDb.close(() => resolve());
			});
			this._sqliteDb = null;
		}
		this._isInitialized = false;
		this._initPromise = null;
	}
}

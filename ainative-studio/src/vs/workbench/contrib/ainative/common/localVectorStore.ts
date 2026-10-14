/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local Vector Store
 * High-performance embedded vector storage engine backed by SQLite (.sutra/index.db)
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

export interface HybridSearchResultItem {
	id: string;
	document: string;
	score: number;
	bm25Rank?: number;
	denseRank?: number;
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

							this._sqliteDb.run(`
								CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
									id UNINDEXED,
									project_id UNINDEXED,
									file_path,
									text
								);
							`, () => {
								// Ignore error if FTS5 is unavailable in the environment
							});

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
						() => {
							this._sqliteDb.run(
								`INSERT OR REPLACE INTO chunks_fts (id, project_id, file_path, text) VALUES (?, ?, ?, ?);`,
								[chunk.chunkId, projectId, chunk.filePath, chunk.text],
								() => resolve()
							);
						}
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
					() => {
						this._sqliteDb.run(
							`DELETE FROM chunks_fts WHERE id = ? AND project_id = ?;`,
							[chunkId, projectId],
							() => resolve()
						);
					}
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
					() => {
						this._sqliteDb.run(
							`DELETE FROM chunks_fts WHERE file_path = ? AND project_id = ?;`,
							[filePath, projectId],
							() => resolve()
						);
					}
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
	 * Tokenize text into normalized alphanumeric words and camelCase subwords
	 */
	private _tokenize(text: string): string[] {
		const words = text.match(/[A-Za-z0-9_$]+/g) || [];
		const tokens: string[] = [];
		for (const word of words) {
			const lower = word.toLowerCase();
			tokens.push(lower);
			const subwords = word.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(' ');
			if (subwords.length > 1) {
				for (const sub of subwords) {
					const subLower = sub.toLowerCase();
					if (subLower && subLower !== lower) {
						tokens.push(subLower);
					}
				}
			}
		}
		return tokens;
	}

	/**
	 * Hybrid BM25 lexical + dense vector semantic search fused via Reciprocal Rank Fusion (RRF)
	 */
	public async hybridSearch(
		projectId: string,
		queryText: string,
		queryEmbedding?: Float32Array,
		limit: number = 10,
		threshold: number = 0.05
	): Promise<HybridSearchResultItem[]> {
		await this.init();

		const embedding = queryEmbedding ?? LocalEmbeddingEngine.embed(queryText);
		const queryTokens = this._tokenize(queryText);

		// Collect project chunks
		const projectChunks: VectorChunkRecord[] = [];
		for (const chunk of this._chunks.values()) {
			if (chunk.projectId === projectId) {
				projectChunks.push(chunk);
			}
		}

		if (projectChunks.length === 0) {
			return [];
		}

		// --- 1. Dense Semantic Retrieval ---
		const denseRanked: { chunk: VectorChunkRecord; similarity: number }[] = [];
		for (const chunk of projectChunks) {
			const sim = LocalEmbeddingEngine.cosineSimilarity(embedding, chunk.embedding);
			if (sim >= threshold) {
				denseRanked.push({ chunk, similarity: sim });
			}
		}
		denseRanked.sort((a, b) => b.similarity - a.similarity);

		const denseRankMap = new Map<string, { rank: number; similarity: number }>();
		denseRanked.forEach((item, idx) => {
			denseRankMap.set(item.chunk.id, { rank: idx + 1, similarity: item.similarity });
		});

		// --- 2. Lexical BM25 Retrieval ---
		const bm25RankMap = new Map<string, number>();
		if (queryTokens.length > 0) {
			const N = projectChunks.length;
			const docFreq = new Map<string, number>();
			const chunkTokensMap = new Map<string, string[]>();
			let totalDocLen = 0;

			for (const chunk of projectChunks) {
				const tokens = this._tokenize(`${chunk.filePath} ${chunk.text}`);
				chunkTokensMap.set(chunk.id, tokens);
				totalDocLen += tokens.length;

				const seenInDoc = new Set<string>(tokens);
				for (const qToken of queryTokens) {
					if (seenInDoc.has(qToken)) {
						docFreq.set(qToken, (docFreq.get(qToken) || 0) + 1);
					}
				}
			}

			const avgdl = totalDocLen / (N || 1);
			const k1 = 1.2;
			const b = 0.75;

			const bm25Scores: { chunk: VectorChunkRecord; score: number }[] = [];

			for (const chunk of projectChunks) {
				const tokens = chunkTokensMap.get(chunk.id) || [];
				const docLen = tokens.length;

				const tfMap = new Map<string, number>();
				for (const t of tokens) {
					tfMap.set(t, (tfMap.get(t) || 0) + 1);
				}

				let docScore = 0;
				for (const qToken of queryTokens) {
					const f = tfMap.get(qToken) || 0;
					if (f === 0) continue;

					const n = docFreq.get(qToken) || 0;
					const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
					const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLen / (avgdl || 1))));
					docScore += idf * tfNorm;
				}

				if (docScore > 0) {
					bm25Scores.push({ chunk, score: docScore });
				}
			}

			bm25Scores.sort((a, b) => b.score - a.score);
			bm25Scores.forEach((item, idx) => {
				bm25RankMap.set(item.chunk.id, idx + 1);
			});
		}

		// --- 3. Reciprocal Rank Fusion (RRF) ---
		// RRF Score = 1 / (60 + rank_bm25) + 1 / (60 + rank_dense)
		const candidateIds = new Set<string>([...denseRankMap.keys(), ...bm25RankMap.keys()]);
		const results: HybridSearchResultItem[] = [];
		const RRF_K = 60;

		for (const chunkId of candidateIds) {
			const chunk = this._chunks.get(chunkId);
			if (!chunk) continue;

			const denseInfo = denseRankMap.get(chunkId);
			const bm25Rank = bm25RankMap.get(chunkId);

			let rrfScore = 0;
			if (bm25Rank !== undefined) {
				rrfScore += 1 / (RRF_K + bm25Rank);
			}
			if (denseInfo !== undefined) {
				rrfScore += 1 / (RRF_K + denseInfo.rank);
			}

			const similarity = denseInfo?.similarity ?? LocalEmbeddingEngine.cosineSimilarity(embedding, chunk.embedding);

			results.push({
				id: chunk.id,
				document: chunk.text,
				score: rrfScore,
				bm25Rank,
				denseRank: denseInfo?.rank,
				similarity,
				metadata: chunk.metadata
			});
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
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

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LocalVectorStore } from '../../common/localVectorStore.js';
import { LocalEmbeddingEngine } from '../../common/localEmbeddingEngine.js';

suite('LocalVectorStore', () => {

	let store: LocalVectorStore;

	setup(async () => {
		store = new LocalVectorStore(':memory:');
		await store.init();
	});

	teardown(async () => {
		await store.close();
	});

	test('should ensure project idempotently', async () => {
		const proj1 = await store.ensureProject('hash_1234567890abcdef', 'my-repo');
		assert.ok(proj1.id.startsWith('proj_'));
		assert.strictEqual(proj1.name, 'my-repo');
		assert.strictEqual(proj1.created, true);

		const proj2 = await store.ensureProject('hash_1234567890abcdef', 'my-repo');
		assert.strictEqual(proj2.id, proj1.id);
		assert.strictEqual(proj2.created, false);
	});

	test('should upsert and search vector chunks', async () => {
		const proj = await store.ensureProject('repo_test_1', 'test-repo');

		const code1 = 'function authenticateUser(user, pass) { return checkAuth(user, pass); }';
		const code2 = 'function renderHtmlCanvas(ctx) { ctx.fillRect(0, 0, 100, 100); }';

		const emb1 = LocalEmbeddingEngine.embed(code1);
		const emb2 = LocalEmbeddingEngine.embed(code2);

		await store.upsertChunk(
			proj.id,
			{ chunkId: 'auth.ts#L1-5', filePath: 'auth.ts', startLine: 1, endLine: 5, text: code1 },
			emb1
		);

		await store.upsertChunk(
			proj.id,
			{ chunkId: 'canvas.ts#L1-5', filePath: 'canvas.ts', startLine: 1, endLine: 5, text: code2 },
			emb2
		);

		const count = await store.getChunkCount(proj.id);
		assert.strictEqual(count, 2);

		const queryEmb = LocalEmbeddingEngine.embed('authenticate user credentials');
		const results = await store.search(proj.id, queryEmb, 5, 0.1);

		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].id, 'auth.ts#L1-5');
		assert.ok(results[0].similarity > 0.3);
	});

	test('should delete single chunk and file chunks', async () => {
		const proj = await store.ensureProject('repo_test_2', 'test-repo');

		const emb = LocalEmbeddingEngine.embed('some code');
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'f1.ts#L1-5', filePath: 'f1.ts', startLine: 1, endLine: 5, text: 'code 1' },
			emb
		);
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'f1.ts#L6-10', filePath: 'f1.ts', startLine: 6, endLine: 10, text: 'code 2' },
			emb
		);
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'f2.ts#L1-5', filePath: 'f2.ts', startLine: 1, endLine: 5, text: 'code 3' },
			emb
		);

		assert.strictEqual(await store.getChunkCount(proj.id), 3);

		// Delete single chunk
		await store.deleteChunk(proj.id, 'f1.ts#L1-5');
		assert.strictEqual(await store.getChunkCount(proj.id), 2);

		// Delete all chunks for f1.ts
		await store.deleteFileChunks(proj.id, 'f1.ts');
		assert.strictEqual(await store.getChunkCount(proj.id), 1);
	});

	test('should achieve < 50ms search latency across 10,000 code chunks', async () => {
		const proj = await store.ensureProject('perf_repo', 'perf');
		const dim = LocalEmbeddingEngine.DIMENSION;
		const totalChunks = 10000;

		// Populate 10,000 synthetic vector chunks
		for (let i = 0; i < totalChunks; i++) {
			const arr = new Float32Array(dim);
			arr[i % dim] = 1.0; // Sparse unit vector
			await store.upsertChunk(
				proj.id,
				{
					chunkId: `file_${Math.floor(i / 10)}.ts#L${(i % 10) * 10 + 1}-${(i % 10) * 10 + 10}`,
					filePath: `file_${Math.floor(i / 10)}.ts`,
					startLine: (i % 10) * 10 + 1,
					endLine: (i % 10) * 10 + 10,
					text: `function benchmarkFunc_${i}() { return ${i}; }`
				},
				arr
			);
		}

		assert.strictEqual(await store.getChunkCount(proj.id), totalChunks);

		const queryVec = new Float32Array(dim);
		queryVec[42] = 1.0;

		const start = performance.now();
		const results = await store.search(proj.id, queryVec, 10, 0.0);
		const duration = performance.now() - start;

		assert.ok(results.length > 0);
		assert.ok(duration < 50, `Search took ${duration.toFixed(2)}ms, expected < 50ms`);
	});

	test('should perform hybrid BM25 + dense search and rank exact identifier match top-1', async () => {
		const proj = await store.ensureProject('hybrid_repo_1', 'hybrid-test');

		const c1 = 'function handleUserSessionTimeout(session) { return session.invalidate(); }';
		const c2 = 'const API_RATE_LIMIT_EXCEEDED = "Rate limit reached, please retry later";';
		const c3 = 'function calculateTaxForIndianStates(amount, state) { return amount * 0.18; }';

		await store.upsertChunk(
			proj.id,
			{ chunkId: 'c1.ts#L1-5', filePath: 'session.ts', startLine: 1, endLine: 5, text: c1 },
			LocalEmbeddingEngine.embed(c1)
		);
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'c2.ts#L1-5', filePath: 'constants.ts', startLine: 1, endLine: 5, text: c2 },
			LocalEmbeddingEngine.embed(c2)
		);
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'c3.ts#L1-5', filePath: 'tax.ts', startLine: 1, endLine: 5, text: c3 },
			LocalEmbeddingEngine.embed(c3)
		);

		// Query for exact identifier
		const results = await store.hybridSearch(proj.id, 'API_RATE_LIMIT_EXCEEDED', undefined, 5, 0.01);
		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].id, 'c2.ts#L1-5');
		assert.strictEqual(results[0].bm25Rank, 1);
		assert.ok(results[0].score > 0);
	});

	test('should retrieve semantically relevant code when conceptual query is provided', async () => {
		const proj = await store.ensureProject('hybrid_repo_2', 'semantic-test');

		const c1 = 'function authenticateUserCredentials(username, password) { return verifyHash(password); }';
		const c2 = 'function renderSvgCanvasElement(node, context) { return context.draw(node); }';

		await store.upsertChunk(
			proj.id,
			{ chunkId: 'auth.ts#L1-5', filePath: 'auth.ts', startLine: 1, endLine: 5, text: c1 },
			LocalEmbeddingEngine.embed(c1)
		);
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'render.ts#L1-5', filePath: 'render.ts', startLine: 1, endLine: 5, text: c2 },
			LocalEmbeddingEngine.embed(c2)
		);

		// Semantic query without exact word match
		const results = await store.hybridSearch(proj.id, 'user login verification security check', undefined, 5, 0.01);
		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].id, 'auth.ts#L1-5');
		assert.ok(results[0].similarity > 0.1);
	});

	test('should handle empty or punctuation-only query gracefully', async () => {
		const proj = await store.ensureProject('hybrid_repo_3', 'empty-query-test');

		const code = 'function testEmpty() { return true; }';
		await store.upsertChunk(
			proj.id,
			{ chunkId: 'empty.ts#L1-5', filePath: 'empty.ts', startLine: 1, endLine: 5, text: code },
			LocalEmbeddingEngine.embed(code)
		);

		const resultsEmpty = await store.hybridSearch(proj.id, '   ', undefined, 5, 0.0);
		assert.ok(Array.isArray(resultsEmpty));

		const resultsPunct = await store.hybridSearch(proj.id, '!@#$%', undefined, 5, 0.0);
		assert.ok(Array.isArray(resultsPunct));
	});
});

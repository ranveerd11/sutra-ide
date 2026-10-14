/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LocalEmbeddingEngine, tokenizeCode, EMBEDDING_DIMENSION } from '../../common/localEmbeddingEngine.js';

suite('LocalEmbeddingEngine', () => {

	test('should tokenize code with camelCase and snake_case decomposition', () => {
		const code = 'function getUserProfile_by_id(userId) { return userRepo.findById(userId); }';
		const tokens = tokenizeCode(code);

		assert.ok(tokens.includes('get'));
		assert.ok(tokens.includes('user'));
		assert.ok(tokens.includes('profile'));
		assert.ok(tokens.includes('find'));
	});

	test('should produce 256-dimensional vector', () => {
		const vec = LocalEmbeddingEngine.embed('const x = 42;');
		assert.strictEqual(vec.length, EMBEDDING_DIMENSION);
	});

	test('should produce L2-normalized vector with unit norm', () => {
		const vec = LocalEmbeddingEngine.embed('function calculateMetrics(items) { return items.length; }');
		let sumSq = 0;
		for (let i = 0; i < vec.length; i++) {
			sumSq += vec[i] * vec[i];
		}
		const norm = Math.sqrt(sumSq);
		assert.ok(Math.abs(norm - 1.0) < 1e-4, `Expected unit norm ~1.0, got ${norm}`);
	});

	test('should be deterministic across multiple calls', () => {
		const text = 'class OrderProcessor { process() {} }';
		const vec1 = LocalEmbeddingEngine.embed(text);
		const vec2 = LocalEmbeddingEngine.embed(text);

		for (let i = 0; i < vec1.length; i++) {
			assert.strictEqual(vec1[i], vec2[i]);
		}
	});

	test('should produce high similarity for related code and low similarity for unrelated code', () => {
		const authCode = LocalEmbeddingEngine.embed('function authenticateUser(username, password) { return verifyCredentials(username, password); }');
		const authQuery = LocalEmbeddingEngine.embed('how to authenticate user login credentials');
		const graphicsCode = LocalEmbeddingEngine.embed('function renderWebGLScene(canvas, shaderProgram) { gl.drawElements(); }');

		const relatedSim = LocalEmbeddingEngine.cosineSimilarity(authCode, authQuery);
		const unrelatedSim = LocalEmbeddingEngine.cosineSimilarity(authCode, graphicsCode);

		assert.ok(relatedSim > 0.35, `Expected related similarity > 0.35, got ${relatedSim}`);
		assert.ok(unrelatedSim < 0.15, `Expected unrelated similarity < 0.15, got ${unrelatedSim}`);
		assert.ok(relatedSim > unrelatedSim * 2, `Related similarity (${relatedSim}) should be at least 2x unrelated (${unrelatedSim})`);
	});
});

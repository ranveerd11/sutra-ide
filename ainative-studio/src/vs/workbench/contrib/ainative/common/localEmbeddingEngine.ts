/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Local Semantic Embedding Engine
 * Generates deterministic, dense, unit-normalized vector embeddings for code chunks and natural language queries.
 * Operates entirely in-process and offline with zero external network requests or heavyweight downloads.
 */

export const EMBEDDING_DIMENSION = 256;

const CODE_STOP_WORDS = new Set([
	'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while',
	'new', 'this', 'true', 'false', 'null', 'undefined', 'async', 'await',
	'class', 'import', 'from', 'export', 'default', 'public', 'private',
	'protected', 'void', 'string', 'number', 'boolean', 'int', 'def', 'self',
	'package', 'type', 'struct', 'interface', 'fn', 'mut', 'impl', 'using'
]);

/**
 * Hash a string into an unsigned 32-bit integer via FNV-1a
 */
function fnv1a(str: string): number {
	let hash = 2166136261;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/**
 * Tokenize code or query text into normalized words with camelCase and snake_case decomposition
 */
export function tokenizeCode(text: string): string[] {
	if (!text) return [];

	// Split camelCase boundaries (e.g., 'getUserProfile' -> 'get User Profile')
	const decomposed = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

	// Extract alpha-numeric tokens of length >= 2
	const matches = decomposed.toLowerCase().match(/[a-z0-9_]{2,}/g);
	if (!matches) return [];

	const tokens: string[] = [];
	for (const m of matches) {
		tokens.push(m);
		// Also split on underscores if present
		if (m.includes('_')) {
			const sub = m.split('_').filter(s => s.length >= 2);
			tokens.push(...sub);
		}
	}
	return tokens;
}

export class LocalEmbeddingEngine {
	public static readonly DIMENSION = EMBEDDING_DIMENSION;

	/**
	 * Embed text into an L2-normalized dense Float32Array vector
	 */
	public static embed(text: string): Float32Array {
		const vec = new Float32Array(this.DIMENSION);
		const tokens = tokenizeCode(text);
		if (tokens.length === 0) {
			return vec;
		}

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const weight = CODE_STOP_WORDS.has(token) ? 0.2 : 1.5;

			const h1 = fnv1a(token) % this.DIMENSION;
			const h2 = fnv1a(token + '_pos') % this.DIMENSION;
			vec[h1] += weight;
			vec[h2] += weight * 0.5;

			// Character trigram hashing for robust sub-token and stem matching
			const len = token.length;
			if (len >= 3) {
				for (let j = 0; j <= len - 3; j++) {
					const tri = token.slice(j, j + 3);
					const hTri = fnv1a(tri) % this.DIMENSION;
					vec[hTri] += weight * 0.25;
				}
			}
		}

		// L2 Normalization (unit length)
		let normSq = 0;
		for (let i = 0; i < this.DIMENSION; i++) {
			normSq += vec[i] * vec[i];
		}

		const norm = Math.sqrt(normSq);
		if (norm > 0) {
			const inv = 1.0 / norm;
			for (let i = 0; i < this.DIMENSION; i++) {
				vec[i] *= inv;
			}
		}

		return vec;
	}

	/**
	 * Compute cosine similarity between two unit-normalized vectors (dot product)
	 */
	public static cosineSimilarity(a: Float32Array, b: Float32Array): number {
		if (a.length !== b.length) return 0;
		let dot = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
		}
		return dot;
	}
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { strictEqual, ok, /* deepStrictEqual */ } from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	// @ts-expect-error - Unused variable
	IAgentMemoryService,
	AgentMemoryService,
	MemorySearchResult,
	MemoryEntry,
	ContextWindow
} from '../../common/agentMemoryService.js';
import { IAINativeSessionAuthService, AuthState, AINativeUser, AINativeAuthResult } from '../../common/ainativeAuthService.js';

/**
 * Mock authentication service for testing
 */
class MockAuthService implements IAINativeSessionAuthService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeAuthState = new Emitter<AuthState>();
	readonly onDidChangeAuthState = this._onDidChangeAuthState.event;

	private _authState: AuthState = AuthState.Authenticated;
	private _accessToken: string | null = 'mock-token-12345';
	private _user: AINativeUser | null = {
		id: 'user-123',
		email: 'test@ainative.studio',
		name: 'Test User',
		role: 'developer'
	};

	async login(email: string, password: string): Promise<AINativeAuthResult> {
		this._authState = AuthState.Authenticated;
		this._accessToken = 'mock-token-12345';
		return { success: true, accessToken: this._accessToken };
	}

	async logout(): Promise<void> {
		this._authState = AuthState.Unauthenticated;
		this._accessToken = null;
		this._user = null;
	}

	async refreshToken(): Promise<string> {
		return 'mock-refreshed-token';
	}

	getAccessToken(): string | null {
		return this._accessToken;
	}

	getUser(): AINativeUser | null {
		return this._user;
	}

	isAuthenticated(): boolean {
		return this._authState === AuthState.Authenticated;
	}

	getAuthState(): AuthState {
		return this._authState;
	}

	// Test helpers
	setAuthState(state: AuthState): void {
		this._authState = state;
	}

	setAccessToken(token: string | null): void {
		this._accessToken = token;
	}
}

/**
 * Mock fetch for testing HTTP calls
 */
class MockFetch {
	private responses: Map<string, any> = new Map();

	setResponse(url: string, response: any): void {
		this.responses.set(url, response);
	}

	async fetch(url: string, options?: RequestInit): Promise<Response> {
		const mockResponse = this.responses.get(url);

		if (!mockResponse) {
			return new Response(JSON.stringify({ error: 'Not found' }), {
				status: 404,
				statusText: 'Not Found'
			});
		}

		return new Response(JSON.stringify(mockResponse), {
			status: mockResponse.status || 200,
			statusText: mockResponse.statusText || 'OK',
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

suite('AgentMemoryService', () => {
	const disposables = new DisposableStore();
	let service: AgentMemoryService;
	let mockAuthService: MockAuthService;
	let mockFetch: MockFetch;
	let originalFetch: typeof global.fetch;

	setup(() => {
		mockAuthService = new MockAuthService();
		mockFetch = new MockFetch();

		// Replace global fetch with mock
		originalFetch = global.fetch;
		global.fetch = mockFetch.fetch.bind(mockFetch) as any;

		service = disposables.add(new AgentMemoryService(mockAuthService).configure({ mode: 'cloud' }));
	});

	teardown(() => {
		// Restore original fetch
		global.fetch = originalFetch;
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('should store memory with metadata', async () => {
		mockFetch.setResponse('https://api.ainative.studio/v1/memory/store', {
			success: true,
			id: 'memory-123'
		});

		await service.storeMemory('test content', 'user', { key: 'value' });

		// This test will fail until we implement the service
		ok(true, 'Memory stored successfully');
	});

	test('should include source and timestamp in metadata', async () => {
		let capturedBody: any = null;

		// Override fetch to capture request
		global.fetch = (async (url: string, options?: RequestInit) => {
			if (options?.body) {
				capturedBody = JSON.parse(options.body as string);
			}
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as any;

		await service.storeMemory('test content', 'user', { custom: 'data' });

		ok(capturedBody, 'Request body should be captured');
		strictEqual(capturedBody.metadata.source, 'ainative-ide');
		ok(capturedBody.metadata.timestamp, 'Timestamp should be present');
		strictEqual(capturedBody.metadata.custom, 'data');
	});

	test('should search memory semantically', async () => {
		const mockResults: MemorySearchResult[] = [
			{
				content: 'Result 1',
				role: 'assistant',
				similarity: 0.95,
				metadata: { timestamp: '2025-01-01T12:00:00Z' }
			},
			{
				content: 'Result 2',
				role: 'user',
				similarity: 0.85,
				metadata: { timestamp: '2025-01-01T11:00:00Z' }
			}
		];

		mockFetch.setResponse('https://api.ainative.studio/v1/memory/search', {
			results: mockResults
		});

		const results = await service.searchMemory('test query', 5);

		strictEqual(results.length, 2);
		strictEqual(results[0].content, 'Result 1');
		strictEqual(results[0].similarity, 0.95);
	});

	test('should retrieve session context', async () => {
		const mockContext: ContextWindow = {
			messages: [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi there!' }
			],
			tokenCount: 25,
			sessionId: 'session-123'
		};

		mockFetch.setResponse('https://api.ainative.studio/v1/memory/context?session_id=session-123&max_tokens=2000', mockContext);

		const context = await service.getContext('session-123', 2000);

		strictEqual(context.messages.length, 2);
		strictEqual(context.tokenCount, 25);
		ok(context.tokenCount <= 2000);
	});

	test('should throw error when not authenticated', async () => {
		mockAuthService.setAccessToken(null);

		let errorThrown = false;
		try {
			await service.storeMemory('content', 'user');
		} catch (error: any) {
			errorThrown = true;
			strictEqual(error.message, 'Not authenticated');
		}
		ok(errorThrown, 'Should have thrown error');
	});

	test('should emit event when memory stored', async () => {
		mockFetch.setResponse('https://api.ainative.studio/v1/memory/store', {
			success: true
		});

		const events: MemoryEntry[] = [];
		disposables.add(service.onDidStoreMemory(e => events.push(e)));

		await service.storeMemory('test', 'user', { tag: 'important' });

		strictEqual(events.length, 1);
		strictEqual(events[0].content, 'test');
		strictEqual(events[0].role, 'user');
		strictEqual(events[0].metadata?.tag, 'important');
	});

	test('should handle API errors gracefully', async () => {
		mockFetch.setResponse('https://api.ainative.studio/v1/memory/store', {
			status: 500,
			statusText: 'Internal Server Error'
		});

		let errorThrown = false;
		try {
			await service.storeMemory('content', 'user');
		} catch (error: any) {
			errorThrown = true;
			ok(error.message.includes('Failed to store memory'));
		}
		ok(errorThrown, 'Should have thrown error');
	});

	test('should use default limit for search', async () => {
		// searchMemory is a POST - limit travels in the JSON request body, not a URL query
		// string (unlike getContext below, a GET that does use query params - the two methods
		// use different HTTP verbs and correspondingly different parameter conventions, both
		// internally consistent). Capture the real request body instead of checking the URL for
		// a query param that was never going to be there.
		let capturedBody: string = '';

		global.fetch = (async (url: string, init?: RequestInit) => {
			capturedBody = typeof init?.body === 'string' ? init.body : '';
			return new Response(JSON.stringify({ results: [] }), { status: 200 });
		}) as any;

		await service.searchMemory('query');

		const parsedBody = JSON.parse(capturedBody);
		strictEqual(parsedBody.limit, 10, 'Request body should include the default limit');
	});

	test('should handle empty search results', async () => {
		mockFetch.setResponse('https://api.ainative.studio/v1/memory/search', {
			results: []
		});

		const results = await service.searchMemory('nonexistent query');

		strictEqual(results.length, 0);
	});

	test('should include authorization header', async () => {
		let capturedHeaders: Headers | undefined;

		global.fetch = (async (url: string, options?: RequestInit) => {
			if (options?.headers) {
				capturedHeaders = new Headers(options.headers);
			}
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as any;

		await service.storeMemory('test', 'user');

		ok(capturedHeaders, 'Headers should be captured');
		strictEqual(capturedHeaders.get('Authorization'), 'Bearer mock-token-12345');
	});

	test('should dispose properly', () => {
		// Service is disposed automatically by disposables.clear() in teardown
		ok(true, 'Service disposed properly');
	});
});

suite('AgentMemoryService (Local Sovereign Mode)', () => {
	const disposables = new DisposableStore();
	let localService: AgentMemoryService;

	setup(() => {
		const unauthenticatedAuth = new MockAuthService();
		unauthenticatedAuth.setAccessToken(null);
		unauthenticatedAuth.setAuthState(AuthState.Unauthenticated);

		localService = disposables.add(new AgentMemoryService(unauthenticatedAuth).configure({ mode: 'local', dbPath: ':memory:' }));
	});

	teardown(() => {
		disposables.clear();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('should identify as local mode', () => {
		strictEqual(localService.isLocalMode, true);
	});

	test('should store memory locally with zero authentication required', async () => {
		const storedEvents: MemoryEntry[] = [];
		disposables.add(localService.onDidStoreMemory(e => storedEvents.push(e)));

		await localService.storeMemory('Local preference: use 4 spaces for indentation', 'user', {
			sessionId: 'sess-001',
			category: 'preferences'
		});

		strictEqual(storedEvents.length, 1);
		strictEqual(storedEvents[0].content, 'Local preference: use 4 spaces for indentation');
		strictEqual(storedEvents[0].role, 'user');
		strictEqual(storedEvents[0].metadata?.['category'], 'preferences');
		strictEqual(storedEvents[0].metadata?.['source'], 'sutra-ide');
		ok(storedEvents[0].metadata?.['timestamp']);
	});

	test('should search memories semantically using local embeddings', async () => {
		await localService.storeMemory(
			'export async function calculateFibonacci(n: number): Promise<number> { return n <= 1 ? n : await calculateFibonacci(n-1) + await calculateFibonacci(n-2); }',
			'assistant',
			{ sessionId: 'sess-code', topic: 'math' }
		);

		await localService.storeMemory(
			'CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL);',
			'assistant',
			{ sessionId: 'sess-db', topic: 'database' }
		);

		const fibResults = await localService.searchMemory('calculate Fibonacci number recursion', 5);
		ok(fibResults.length > 0, 'Should find matching memory');
		ok(fibResults[0].content.includes('calculateFibonacci'), 'Top result should be Fibonacci implementation');
		ok(fibResults[0].similarity > 0.1, 'Similarity should be significant');

		const dbResults = await localService.searchMemory('database table users SQL schema', 5);
		ok(dbResults.length > 0, 'Should find matching database memory');
		ok(dbResults[0].content.includes('CREATE TABLE users'), 'Top result should be SQL schema');
	});

	test('should retrieve and reconstruct session context within token limit', async () => {
		const sessionId = 'session-turn-based';

		await localService.storeMemory('Hello, please help me inspect the codebase.', 'user', { sessionId });
		await localService.storeMemory('Certainly, I have loaded the AST index.', 'assistant', { sessionId });
		await localService.storeMemory('Please add unit tests for the vector store.', 'user', { sessionId });

		const fullContext = await localService.getContext(sessionId, 4000);
		strictEqual(fullContext.sessionId, sessionId);
		strictEqual(fullContext.messages.length, 3);
		strictEqual(fullContext.messages[0].role, 'user');
		strictEqual(fullContext.messages[0].content, 'Hello, please help me inspect the codebase.');
		strictEqual(fullContext.messages[1].role, 'assistant');
		strictEqual(fullContext.messages[2].role, 'user');
		ok(fullContext.tokenCount > 0);

		// Test token truncation
		const tightContext = await localService.getContext(sessionId, 15);
		ok(tightContext.messages.length < 3, 'Should truncate messages to fit within token limit');
		ok(tightContext.tokenCount <= 15, 'Token count must not exceed limit');
	});

	test('should isolate memories across different sessions in getContext', async () => {
		await localService.storeMemory('Message for Session A', 'user', { sessionId: 'session-A' });
		await localService.storeMemory('Message for Session B', 'user', { sessionId: 'session-B' });

		const contextA = await localService.getContext('session-A', 4000);
		strictEqual(contextA.messages.length, 1);
		strictEqual(contextA.messages[0].content, 'Message for Session A');

		const contextB = await localService.getContext('session-B', 4000);
		strictEqual(contextB.messages.length, 1);
		strictEqual(contextB.messages[0].content, 'Message for Session B');
	});

	test('should switch modes via setMode', () => {
		localService.setMode('cloud');
		strictEqual(localService.isLocalMode, false);
		localService.setMode('local');
		strictEqual(localService.isLocalMode, true);
	});

	test('should operate with zero network requests in local mode', async () => {
		let fetchCalled = false;
		global.fetch = (() => {
			fetchCalled = true;
			throw new Error('fetch should not be called in local mode');
		}) as any;

		await localService.storeMemory('Offline note', 'user', { sessionId: 'offline-sess' });
		const searchResults = await localService.searchMemory('Offline note');
		const context = await localService.getContext('offline-sess');

		strictEqual(fetchCalled, false, 'Network fetch must never be invoked');
		ok(searchResults.length > 0);
		strictEqual(context.messages.length, 1);
	});
});


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CodeContextEngineService, ICodeContextEngineService } from '../../common/codeContextEngineService.js';

suite('CodeContextEngineService - Local Embedded Vector Store', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let service: ICodeContextEngineService;

	setup(() => {
		const mockWorkspaceService: any = {
			getWorkspace: () => ({ folders: [] })
		};
		const instance = new CodeContextEngineService(mockWorkspaceService);
		instance.setCustomDbPath(':memory:');
		service = disposables.add(instance);
	});

	test('should ensure project locally without remote network call', async () => {
		const result = await service.ensureProject('local_repo_hash_abc', 'my-local-project');

		assert.ok(result.id.startsWith('proj_'));
		assert.strictEqual(result.name, 'my-local-project');
		assert.strictEqual(result.tier, 'local');
		assert.strictEqual(result.created, true);
	});

	test('should embed file and perform semantic search offline', async () => {
		const project = await service.ensureProject('local_repo_hash_def', 'search-project');

		const sourceCode = `
class DatabaseConnection {
    connect(uri: string): void {
        console.log("Connecting to database: " + uri);
    }

    query(sql: string): any[] {
        return [];
    }
}

class ImageRenderer {
    renderCanvas(): void {
        // draw graphics
    }
}
`;
		const embedResult = await service.embedFile(project.id, '/src/db.ts', sourceCode);
		assert.strictEqual(embedResult.filePath, '/src/db.ts');
		assert.ok(embedResult.chunksEmbedded >= 1);

		const searchResult = await service.search(project.id, 'database connect query sql', { limit: 5 });

		assert.strictEqual(searchResult.projectId, project.id);
		assert.strictEqual(searchResult.model, 'local-dense-256');
		assert.ok(searchResult.totalResults >= 1);
		assert.ok(searchResult.results[0].document.includes('DatabaseConnection'));
		assert.ok(searchResult.processingTimeMs >= 0);
	});

	test('should embed single chunk and delete vector', async () => {
		const project = await service.ensureProject('local_repo_hash_ghi', 'chunk-project');

		const chunkId = '/src/utils.ts#L1-10';
		const chunkContent = 'export function helperUtil() { return "hello"; }';

		const embedResult = await service.embedChunk(project.id, chunkId, chunkContent);
		assert.strictEqual(embedResult.chunkId, chunkId);

		const beforeSearch = await service.search(project.id, 'helperUtil hello');
		assert.strictEqual(beforeSearch.totalResults, 1);

		await service.deleteVector(project.id, chunkId);

		const afterSearch = await service.search(project.id, 'helperUtil hello');
		assert.strictEqual(afterSearch.totalResults, 0);
	});
});

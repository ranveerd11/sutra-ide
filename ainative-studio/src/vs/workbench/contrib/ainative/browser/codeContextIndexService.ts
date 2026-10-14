/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ICodeContextEngineService } from '../common/codeContextEngineService.js';
import { IAINativeSCMService } from '../common/ainativeSCMTypes.js';
import { computeRepoHash } from '../common/codeContextProjectHash.js';
import { chunkFileContent } from '../common/codeContextChunking.js';
import { diffChunkIds } from '../common/codeContextIndexDiff.js';

/**
 * Orchestrates codebase-wide semantic retrieval: provisions a local project per
 * workspace under `.nova/index.db`, runs an initial workspace embedding pass on startup,
 * and maintains continuous incremental re-indexing via a debounced file-system watcher.
 */
export interface ICodeContextIndexService {
	readonly _serviceBrand: undefined;

	/**
	 * Ensures a local project exists for the current workspace's first folder and runs an
	 * initial embed pass over files found by the search service. Operates completely offline.
	 */
	indexWorkspace(): Promise<{ projectId: string; filesIndexed: number } | undefined>;

	/** Re-indexes one file: diffs previous chunk ids against current ones, deletes stale vectors, and embeds new ones. */
	reindexFile(projectId: string, fileUri: URI): Promise<void>;

	/** The project id from the most recent indexWorkspace() call, or undefined if indexing hasn't run. */
	getCurrentProjectId(): string | undefined;
}

export const ICodeContextIndexService = createDecorator<ICodeContextIndexService>('codeContextIndexService');

class CodeContextIndexService extends Disposable implements ICodeContextIndexService {
	readonly _serviceBrand: undefined;

	private readonly _chunkIdsByFile = new Map<string, string[]>(); // key: fileUri.toString()
	private _currentProjectId: string | undefined;
	private _fileChangeDebounceTimer: any = null;
	private readonly _pendingFilesToReindex = new Set<string>();

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: ISearchService,
		@ICodeContextEngineService private readonly codeContextEngineService: ICodeContextEngineService,
		@IAINativeSCMService private readonly scmService: IAINativeSCMService,
	) {
		super();
		this._registerFileWatcher();
	}

	private _registerFileWatcher(): void {
		this._register(this.fileService.onDidFilesChange(e => {
			if (!this._currentProjectId) return;

			const resources = [...e.rawAdded, ...e.rawUpdated, ...e.rawDeleted];
			for (const resource of resources) {
				const path = resource.fsPath;
				if (path.includes('.git') || path.includes('node_modules') || path.includes('.nova') || path.includes('out/')) {
					continue;
				}

				this._pendingFilesToReindex.add(resource.toString());
			}

			if (this._pendingFilesToReindex.size > 0) {
				if (this._fileChangeDebounceTimer) {
					clearTimeout(this._fileChangeDebounceTimer);
				}
				this._fileChangeDebounceTimer = setTimeout(() => {
					this._processPendingReindexes();
				}, 500);
			}
		}));
	}

	private async _processPendingReindexes(): Promise<void> {
		if (!this._currentProjectId) return;
		const files = Array.from(this._pendingFilesToReindex);
		this._pendingFilesToReindex.clear();

		for (const uriStr of files) {
			try {
				const uri = URI.parse(uriStr);
				await this.reindexFile(this._currentProjectId, uri);
			} catch {
				// Ignore individual file reindex failures
			}
		}
	}

	async indexWorkspace(): Promise<{ projectId: string; filesIndexed: number } | undefined> {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) return undefined;

		const remoteUrl = await this.scmService.gitRemoteUrl(folder.uri.fsPath);
		const repoHash = await computeRepoHash(remoteUrl || `local:${folder.name}`);
		const project = await this.codeContextEngineService.ensureProject(repoHash, folder.name);
		this._currentProjectId = project.id;

		const queryBuilder = this.instantiationService.createInstance(QueryBuilder);
		const query = queryBuilder.file([folder.uri]);
		const searchResult = await this.searchService.fileSearch(query, CancellationToken.None);

		let filesIndexed = 0;
		for (const match of searchResult.results) {
			try {
				await this._embedFile(project.id, match.resource);
				filesIndexed++;
			} catch {
				continue;
			}
		}

		return { projectId: project.id, filesIndexed };
	}

	async reindexFile(projectId: string, fileUri: URI): Promise<void> {
		const exists = await this.fileService.exists(fileUri);
		if (!exists) {
			const previousChunkIds = this._chunkIdsByFile.get(fileUri.toString()) ?? [];
			await Promise.all(previousChunkIds.map(id => this.codeContextEngineService.deleteVector(projectId, id)));
			this._chunkIdsByFile.delete(fileUri.toString());
			return;
		}
		await this._embedFile(projectId, fileUri);
	}

	private async _embedFile(projectId: string, fileUri: URI): Promise<void> {
		const content = (await this.fileService.readFile(fileUri)).value.toString();
		const chunks = chunkFileContent(fileUri.toString(), content);
		const currentChunkIds = chunks.map(c => c.chunkId);

		const previousChunkIds = this._chunkIdsByFile.get(fileUri.toString()) ?? [];
		const { chunkIdsToDelete } = diffChunkIds(previousChunkIds, currentChunkIds);

		await Promise.all(chunkIdsToDelete.map(id => this.codeContextEngineService.deleteVector(projectId, id)));
		if (currentChunkIds.length > 0) {
			await this.codeContextEngineService.embedFile(projectId, fileUri.toString(), content);
		}

		this._chunkIdsByFile.set(fileUri.toString(), currentChunkIds);
	}

	getCurrentProjectId(): string | undefined {
		return this._currentProjectId;
	}

	override dispose(): void {
		if (this._fileChangeDebounceTimer) {
			clearTimeout(this._fileChangeDebounceTimer);
			this._fileChangeDebounceTimer = null;
		}
		super.dispose();
	}
}

registerSingleton(ICodeContextIndexService, CodeContextIndexService, InstantiationType.Delayed);

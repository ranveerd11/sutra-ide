/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { UnifiedCatalogService } from '../../../common/marketplace/unifiedCatalogService.js';
import { ICommunityMarketplace } from '../../../common/marketplace/communityMarketplaceTypes.js';
import { IMCPService } from '../../../common/mcpService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { MarketplaceSkill } from '../../../common/marketplace/marketplaceTypes.js';

suite('UnifiedCatalogService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const mockSkills: MarketplaceSkill[] = [
		{
			name: 'git-workflows',
			description: 'Automated Git workflows and conventions',
			version: '1.0.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['git', 'automation'],
			rating: 4.9,
			downloads: 1200,
			updatedAt: new Date(),
			installCommand: 'sutra skill install git-workflows',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		},
		{
			name: 'sqlite-patterns',
			description: 'Embedded SQLite schemas and FTS5 search',
			version: '1.2.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['sqlite', 'database'],
			rating: 4.8,
			downloads: 950,
			updatedAt: new Date(),
			installCommand: 'sutra skill install sqlite-patterns',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		}
	];

	let installedSkills: string[] = [];
	let installedMcpServers: string[] = [];
	let toggledMcpServers: Record<string, boolean> = {};

	const mockCommunityMarketplace: Partial<ICommunityMarketplace> = {
		fetchSkills: async () => mockSkills,
		install: async (name: string) => {
			installedSkills.push(name);
		}
	};

	const mockMcpService: Partial<IMCPService> = {
		state: {
			mcpServerOfName: { memory: {} as any },
			error: undefined
		},
		installFromRegistry: async (entry: any) => {
			installedMcpServers.push(entry.id);
			return { ok: true, configFileJSON: {} as any, overwritten: false };
		},
		toggleServerIsOn: async (name: string, isOn: boolean) => {
			toggledMcpServers[name] = isOn;
		}
	};

	const mockFileService: Partial<IFileService> = {
		createFolder: async () => ({} as any),
		writeFile: async () => ({} as any)
	};

	setup(() => {
		installedSkills = [];
		installedMcpServers = [];
		toggledMcpServers = {};
	});

	test('should return all 5 supported marketplace categories', () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const categories = service.getCategories();
		assert.strictEqual(categories.length, 5);
		const categoryIds = categories.map(c => c.id);
		assert.strictEqual(categoryIds.includes('extension'), true);
		assert.strictEqual(categoryIds.includes('skill'), true);
		assert.strictEqual(categoryIds.includes('mcp'), true);
		assert.strictEqual(categoryIds.includes('hook'), true);
		assert.strictEqual(categoryIds.includes('vibe'), true);
		service.dispose();
	});

	test('should aggregate items across all categories in default query', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const result = await service.queryCatalog();
		assert.strictEqual(result.items.length > 0, true);
		assert.strictEqual(result.categoryCounts.extension > 0, true);
		assert.strictEqual(result.categoryCounts.skill, 2);
		assert.strictEqual(result.categoryCounts.mcp > 0, true);
		assert.strictEqual(result.categoryCounts.hook, 4);
		assert.strictEqual(result.categoryCounts.vibe, 4);
		service.dispose();
	});

	test('should filter by specific category', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const skillResults = await service.queryCatalog({ category: 'skill' });
		assert.strictEqual(skillResults.items.every(i => i.category === 'skill'), true);
		assert.strictEqual(skillResults.items.length, 2);

		const hookResults = await service.queryCatalog({ category: 'hook' });
		assert.strictEqual(hookResults.items.every(i => i.category === 'hook'), true);
		assert.strictEqual(hookResults.items.length, 4);

		const vibeResults = await service.queryCatalog({ category: 'vibe' });
		assert.strictEqual(vibeResults.items.every(i => i.category === 'vibe'), true);
		assert.strictEqual(vibeResults.items.length, 4);
		service.dispose();
	});

	test('should perform multi-attribute search across title, description, and tags', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const searchGit = await service.queryCatalog({ query: 'git' });
		assert.strictEqual(searchGit.items.length > 0, true);
		assert.strictEqual(
			searchGit.items.some(i => i.id === 'skill:git-workflows' || i.id === 'ext:eamodio.gitlens'),
			true
		);

		const searchSecurity = await service.queryCatalog({ query: 'security' });
		assert.strictEqual(searchSecurity.items.length > 0, true);
		assert.strictEqual(searchSecurity.items.some(i => i.id === 'vibe:auditor'), true);
		service.dispose();
	});

	test('should sort catalog items by downloads and rating', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const sortedByDownloads = await service.queryCatalog({ sortBy: 'downloads' });
		for (let i = 0; i < sortedByDownloads.items.length - 1; i++) {
			assert.strictEqual(
				sortedByDownloads.items[i].downloads >= sortedByDownloads.items[i + 1].downloads,
				true
			);
		}

		const sortedByRating = await service.queryCatalog({ sortBy: 'rating' });
		for (let i = 0; i < sortedByRating.items.length - 1; i++) {
			assert.strictEqual(
				sortedByRating.items[i].rating >= sortedByRating.items[i + 1].rating,
				true
			);
		}
		service.dispose();
	});

	test('should delegate skill installation to CommunityMarketplace', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		await service.installItem('skill:git-workflows');
		assert.strictEqual(installedSkills.includes('git-workflows'), true);
		service.dispose();
	});

	test('should delegate MCP installation to MCPService', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		await service.installItem('mcp:github');
		assert.strictEqual(installedMcpServers.includes('github'), true);
		service.dispose();
	});

	test('should manage hook installation and toggle state', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		await service.installItem('hook:secret-scan-guard');
		const itemAfterInstall = await service.getItem('hook:secret-scan-guard');
		assert.strictEqual(itemAfterInstall?.installed, true);
		assert.strictEqual(itemAfterInstall?.enabled, true);

		await service.toggleItem('hook:secret-scan-guard', false);
		const itemAfterDisable = await service.getItem('hook:secret-scan-guard');
		assert.strictEqual(itemAfterDisable?.enabled, false);

		await service.uninstallItem('hook:secret-scan-guard');
		const itemAfterUninstall = await service.getItem('hook:secret-scan-guard');
		assert.strictEqual(itemAfterUninstall?.installed, false);
		service.dispose();
	});

	test('should switch active vibe persona', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		await service.installItem('vibe:prototyper');
		const prototyper = await service.getItem('vibe:prototyper');
		const architect = await service.getItem('vibe:architect');

		assert.strictEqual(prototyper?.enabled, true);
		assert.strictEqual(architect?.enabled, false);
		service.dispose();
	});

	test('should retrieve single item by namespaced ID', async () => {
		const service = new UnifiedCatalogService(
			mockCommunityMarketplace as ICommunityMarketplace,
			mockMcpService as IMCPService,
			mockFileService as IFileService
		);

		const item = await service.getItem('ext:ms-python.python');
		assert.strictEqual(item !== null, true);
		assert.strictEqual(item?.name, 'python');
		assert.strictEqual(item?.publisher, 'ms-python');
		assert.strictEqual(item?.category, 'extension');
		service.dispose();
	});
});

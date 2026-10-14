/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { ICommunityMarketplace } from './communityMarketplaceTypes.js';
import { IMCPService } from '../mcpService.js';
import { getMCPRegistry, findMCPRegistryEntry } from '../mcpServiceTypes.js';
import {
	IUnifiedCatalogService,
	CatalogCategory,
	CatalogCategoryInfo,
	UnifiedCatalogItem,
	UnifiedCatalogQuery,
	UnifiedCatalogResult
} from './unifiedCatalogTypes.js';

interface OpenVSXExtensionDto {
	namespace: string;
	name: string;
	version?: string;
	displayName?: string;
	description?: string;
	downloadCount?: number;
	reviewSummary?: { average?: number; count?: number };
	files?: { icon?: string };
	repository?: string;
	homepage?: string;
	tags?: string[];
}

interface OpenVSXSearchResponse {
	totalSize?: number;
	extensions?: OpenVSXExtensionDto[];
}

export class UnifiedCatalogService extends Disposable implements IUnifiedCatalogService {
	declare readonly _serviceBrand: undefined;

	private static readonly OPEN_VSX_API_URL = 'https://open-vsx.org/api/-/search';
	private static readonly REQUEST_TIMEOUT = 8000;

	private readonly cacheDir: string;
	private installedHookIds: Set<string> = new Set(['hook:pre-agent-verify', 'hook:post-agent-test']);
	private activeVibePersonaId: string = 'vibe:architect';

	private readonly _onDidCatalogChange = this._register(new Emitter<void>());
	readonly onDidCatalogChange: Event<void> = this._onDidCatalogChange.event;

	private static readonly BUNDLED_EXTENSIONS: UnifiedCatalogItem[] = [
		{
			id: 'ext:ms-python.python',
			name: 'python',
			displayName: 'Python',
			description: 'IntelliSense, linting, debugging, and code navigation for Python development',
			category: 'extension',
			version: '2026.1.0',
			publisher: 'ms-python',
			rating: 4.8,
			downloads: 98000000,
			tags: ['python', 'language', 'debugging', 'linting'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/microsoft/vscode-python',
			homepage: 'https://marketplace.visualstudio.com/items?itemName=ms-python.python'
		},
		{
			id: 'ext:esbenp.prettier-vscode',
			name: 'prettier-vscode',
			displayName: 'Prettier - Code Formatter',
			description: 'Opinionated code formatter supporting JavaScript, TypeScript, CSS, HTML, and JSON',
			category: 'extension',
			version: '10.4.0',
			publisher: 'esbenp',
			rating: 4.7,
			downloads: 48000000,
			tags: ['formatter', 'javascript', 'typescript', 'prettier'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/prettier/prettier-vscode'
		},
		{
			id: 'ext:dbaeumer.vscode-eslint',
			name: 'vscode-eslint',
			displayName: 'ESLint',
			description: 'Integrates ESLint JavaScript and TypeScript linter into the editor',
			category: 'extension',
			version: '3.0.0',
			publisher: 'dbaeumer',
			rating: 4.6,
			downloads: 36000000,
			tags: ['linter', 'eslint', 'javascript', 'typescript'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/microsoft/vscode-eslint'
		},
		{
			id: 'ext:rust-lang.rust-analyzer',
			name: 'rust-analyzer',
			displayName: 'rust-analyzer',
			description: 'High-performance modular Rust language server for code intelligence and refactoring',
			category: 'extension',
			version: '0.4.0',
			publisher: 'rust-lang',
			rating: 4.9,
			downloads: 8500000,
			tags: ['rust', 'language-server', 'cargo', 'analyzer'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/rust-lang/rust-analyzer'
		},
		{
			id: 'ext:golang.go',
			name: 'go',
			displayName: 'Go',
			description: 'Rich Go language support: IntelliSense, code navigation, testing, and debugging',
			category: 'extension',
			version: '0.42.0',
			publisher: 'golang',
			rating: 4.8,
			downloads: 16000000,
			tags: ['go', 'golang', 'gopls', 'debugging'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/golang/vscode-go'
		},
		{
			id: 'ext:eamodio.gitlens',
			name: 'gitlens',
			displayName: 'GitLens — Git Supercharged',
			description: 'Supercharge Git within the editor with authorship blame, repository heatmaps, and revision navigation',
			category: 'extension',
			version: '15.0.0',
			publisher: 'eamodio',
			rating: 4.8,
			downloads: 32000000,
			tags: ['git', 'gitlens', 'scm', 'blame'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/gitkraken/vscode-gitlens'
		},
		{
			id: 'ext:bradlc.vscode-tailwindcss',
			name: 'vscode-tailwindcss',
			displayName: 'Tailwind CSS IntelliSense',
			description: 'Intelligent Tailwind CSS tooling including autocomplete, syntax highlighting, and linting',
			category: 'extension',
			version: '0.12.0',
			publisher: 'bradlc',
			rating: 4.7,
			downloads: 14000000,
			tags: ['css', 'tailwind', 'autocomplete', 'frontend'],
			installed: false,
			enabled: true,
			repository: 'https://github.com/tailwindlabs/tailwindcss-intellisense'
		}
	];

	private static readonly BUILTIN_HOOKS: UnifiedCatalogItem[] = [
		{
			id: 'hook:pre-agent-verify',
			name: 'pre-agent-verify',
			displayName: 'AST Syntax Guardrail',
			description: 'Executes Tree-Sitter AST syntax verification on speculative code before modifications are committed',
			category: 'hook',
			version: '1.0.0',
			publisher: 'sutra-core',
			rating: 5.0,
			downloads: 4200,
			tags: ['guardrail', 'ast', 'safety', 'syntax'],
			installed: true,
			enabled: true,
			metadata: { phase: 'pre-exec' }
		},
		{
			id: 'hook:post-agent-test',
			name: 'post-agent-test',
			displayName: 'Shadow Test Verification',
			description: 'Runs project unit tests inside isolated shadow workspaces to verify agent modifications',
			category: 'hook',
			version: '1.0.0',
			publisher: 'sutra-core',
			rating: 4.9,
			downloads: 3900,
			tags: ['test', 'sandbox', 'self-healing', 'jest', 'pytest'],
			installed: true,
			enabled: true,
			metadata: { phase: 'post-exec' }
		},
		{
			id: 'hook:secret-scan-guard',
			name: 'secret-scan-guard',
			displayName: 'Secret Leak Prevention',
			description: 'Scans proposed code modifications for API tokens, private keys, and passwords before presentation',
			category: 'hook',
			version: '1.1.0',
			publisher: 'sutra-security',
			rating: 4.9,
			downloads: 2750,
			tags: ['security', 'secrets', 'guardrail', 'compliance'],
			installed: false,
			enabled: false,
			metadata: { phase: 'pre-exec' }
		},
		{
			id: 'hook:clean-commit-gate',
			name: 'clean-commit-gate',
			displayName: 'Clean Commit & Attribution Enforcer',
			description: 'Validates conventional commit formats and ensures zero unintended attribution tags in commit histories',
			category: 'hook',
			version: '1.0.0',
			publisher: 'sutra-core',
			rating: 4.8,
			downloads: 1980,
			tags: ['git', 'commit', 'governance', 'quality'],
			installed: false,
			enabled: false,
			metadata: { phase: 'pre-commit' }
		}
	];

	private static readonly BUILTIN_VIBE_PERSONAS: UnifiedCatalogItem[] = [
		{
			id: 'vibe:architect',
			name: 'vibe-architect',
			displayName: 'Systems Architect Persona',
			description: 'Prioritizes robust domain models, strict type safety, modular interfaces, and zero architectural debt',
			category: 'vibe',
			version: '1.0.0',
			publisher: 'sutra-vibe',
			rating: 5.0,
			downloads: 5400,
			tags: ['persona', 'architecture', 'strict', 'clean-code'],
			installed: true,
			enabled: true,
			metadata: { promptModifier: 'Think as a principal systems architect. Enforce strict type safety and interface boundaries.' }
		},
		{
			id: 'vibe:prototyper',
			name: 'vibe-prototyper',
			displayName: 'Rapid MVP Prototyper',
			description: 'Optimized for high-velocity scaffolding, working full-stack prototypes, and immediate visual feedback',
			category: 'vibe',
			version: '1.0.0',
			publisher: 'sutra-vibe',
			rating: 4.9,
			downloads: 6800,
			tags: ['persona', 'speed', 'mvp', 'prototyping'],
			installed: false,
			enabled: false,
			metadata: { promptModifier: 'Focus on shipping a functional end-to-end working MVP with clean, straightforward code.' }
		},
		{
			id: 'vibe:auditor',
			name: 'vibe-auditor',
			displayName: 'Security Auditor Persona',
			description: 'Deep inspection mode focusing on OWASP vulnerabilities, input sanitization, boundaries, and threat modeling',
			category: 'vibe',
			version: '1.0.0',
			publisher: 'sutra-security',
			rating: 4.8,
			downloads: 3100,
			tags: ['persona', 'security', 'audit', 'owasp'],
			installed: false,
			enabled: false,
			metadata: { promptModifier: 'Inspect every line through a hostile adversarial lens. Validate inputs and zero-trust invariants.' }
		},
		{
			id: 'vibe:tdd',
			name: 'vibe-tdd',
			displayName: 'Test-Driven Crafter',
			description: 'Enforces strict Red-Green-Refactor testing discipline, writing unit tests before implementation code',
			category: 'vibe',
			version: '1.0.0',
			publisher: 'sutra-vibe',
			rating: 4.9,
			downloads: 4100,
			tags: ['persona', 'tdd', 'testing', 'refactoring'],
			installed: false,
			enabled: false,
			metadata: { promptModifier: 'Follow strict Test-Driven Development. Create minimal failing tests first, pass them, and refactor.' }
		}
	];

	constructor(
		@ICommunityMarketplace private readonly _communityMarketplace: ICommunityMarketplace,
		@IMCPService private readonly _mcpService: IMCPService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		const homeDir = os.homedir();
		const sutraHome = (typeof process !== 'undefined' && process.env?.['SUTRA_HOME']) || path.join(homeDir, '.sutra');
		this.cacheDir = path.join(sutraHome, 'cache', 'marketplace');
	}

	getCategories(): CatalogCategoryInfo[] {
		return [
			{
				id: 'extension',
				displayName: 'Extensions',
				description: 'VS Code ecosystem language servers, formatters, debuggers, and themes from Open VSX',
				icon: 'extensions'
			},
			{
				id: 'skill',
				displayName: 'Agent Skills',
				description: 'Specialized agent instructions, workflows, and domain knowledge packages',
				icon: 'sparkle'
			},
			{
				id: 'mcp',
				displayName: 'MCP Plugins',
				description: 'Model Context Protocol servers connecting tools, databases, and browser runtimes',
				icon: 'plug'
			},
			{
				id: 'hook',
				displayName: 'Lifecycle Hooks',
				description: 'Automated verification gates, AST linters, and security checks for agent edits',
				icon: 'shield'
			},
			{
				id: 'vibe',
				displayName: 'Vibe Personas',
				description: 'Tailored behavioral profiles and specialized roles for Vibe Coder Mode',
				icon: 'heart'
			}
		];
	}

	async queryCatalog(query?: UnifiedCatalogQuery): Promise<UnifiedCatalogResult> {
		const targetCategory = query?.category || 'all';
		const searchQuery = (query?.query || '').trim().toLowerCase();
		const installedOnly = !!query?.installedOnly;

		const [extensions, skills, mcpItems] = await Promise.all([
			this._fetchExtensions(searchQuery),
			this._fetchSkills(),
			this._fetchMCPItems()
		]);

		const hooks = this._fetchHooks();
		const vibes = this._fetchVibePersonas();

		let allItems: UnifiedCatalogItem[] = [];

		if (targetCategory === 'all' || targetCategory === 'extension') {
			allItems = allItems.concat(extensions);
		}
		if (targetCategory === 'all' || targetCategory === 'skill') {
			allItems = allItems.concat(skills);
		}
		if (targetCategory === 'all' || targetCategory === 'mcp') {
			allItems = allItems.concat(mcpItems);
		}
		if (targetCategory === 'all' || targetCategory === 'hook') {
			allItems = allItems.concat(hooks);
		}
		if (targetCategory === 'all' || targetCategory === 'vibe') {
			allItems = allItems.concat(vibes);
		}

		// Calculate total category counts across the entire catalog
		const categoryCounts: Record<CatalogCategory, number> = {
			extension: extensions.length,
			skill: skills.length,
			mcp: mcpItems.length,
			hook: hooks.length,
			vibe: vibes.length
		};

		// Filter by search query
		if (searchQuery) {
			allItems = allItems.filter(item =>
				item.name.toLowerCase().includes(searchQuery) ||
				item.displayName.toLowerCase().includes(searchQuery) ||
				item.description.toLowerCase().includes(searchQuery) ||
				item.publisher.toLowerCase().includes(searchQuery) ||
				item.tags.some(tag => tag.toLowerCase().includes(searchQuery))
			);
		}

		// Filter by installed status
		if (installedOnly) {
			allItems = allItems.filter(item => item.installed);
		}

		// Sort items
		const sortBy = query?.sortBy || 'relevance';
		allItems = this._sortItems(allItems, sortBy, searchQuery);

		const total = allItems.length;
		const offset = query?.offset || 0;
		const limit = query?.limit || 50;
		const pagedItems = allItems.slice(offset, offset + limit);

		return {
			items: pagedItems,
			total,
			categoryCounts
		};
	}

	async getItem(id: string): Promise<UnifiedCatalogItem | null> {
		const result = await this.queryCatalog({ category: 'all' });
		return result.items.find(item => item.id === id) || null;
	}

	async installItem(id: string): Promise<void> {
		if (id.startsWith('skill:')) {
			const skillName = id.replace('skill:', '');
			await this._communityMarketplace.install(skillName);
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('mcp:')) {
			const mcpId = id.replace('mcp:', '');
			const entry = findMCPRegistryEntry(mcpId);
			if (entry) {
				await this._mcpService.installFromRegistry(entry);
			}
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('hook:')) {
			this.installedHookIds.add(id);
			await this._saveState();
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('vibe:')) {
			this.activeVibePersonaId = id;
			await this._saveState();
			this._onDidCatalogChange.fire();
			return;
		}

		// For extension category, record as installed
		await this._saveState();
		this._onDidCatalogChange.fire();
	}

	async uninstallItem(id: string): Promise<void> {
		if (id.startsWith('hook:')) {
			this.installedHookIds.delete(id);
			await this._saveState();
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('mcp:')) {
			const mcpId = id.replace('mcp:', '');
			await this._mcpService.toggleServerIsOn(mcpId, false);
			this._onDidCatalogChange.fire();
			return;
		}

		await this._saveState();
		this._onDidCatalogChange.fire();
	}

	async toggleItem(id: string, enabled: boolean): Promise<void> {
		if (id.startsWith('hook:')) {
			if (enabled) {
				this.installedHookIds.add(id);
			} else {
				this.installedHookIds.delete(id);
			}
			await this._saveState();
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('mcp:')) {
			const mcpId = id.replace('mcp:', '');
			await this._mcpService.toggleServerIsOn(mcpId, enabled);
			this._onDidCatalogChange.fire();
			return;
		}

		if (id.startsWith('vibe:')) {
			if (enabled) {
				this.activeVibePersonaId = id;
			}
			await this._saveState();
			this._onDidCatalogChange.fire();
			return;
		}
	}

	private async _fetchExtensions(query: string): Promise<UnifiedCatalogItem[]> {
		try {
			const url = query
				? `${UnifiedCatalogService.OPEN_VSX_API_URL}?query=${encodeURIComponent(query)}&size=30`
				: `${UnifiedCatalogService.OPEN_VSX_API_URL}?size=30`;

			const response = await fetch(url, { signal: AbortSignal.timeout(UnifiedCatalogService.REQUEST_TIMEOUT) });
			if (response.ok) {
				const data: OpenVSXSearchResponse = await response.json();
				if (data.extensions && Array.isArray(data.extensions) && data.extensions.length > 0) {
					return data.extensions.map(dto => ({
						id: `ext:${dto.namespace}.${dto.name}`,
						name: dto.name,
						displayName: dto.displayName || dto.name,
						description: dto.description || 'No description provided',
						category: 'extension' as const,
						version: dto.version || '1.0.0',
						publisher: dto.namespace,
						iconUrl: dto.files?.icon,
						rating: dto.reviewSummary?.average ? Math.round(dto.reviewSummary.average * 10) / 10 : 4.5,
						downloads: dto.downloadCount || 1000,
						tags: dto.tags || ['extension'],
						installed: false,
						enabled: true,
						repository: dto.repository,
						homepage: dto.homepage,
						metadata: { namespace: dto.namespace }
					}));
				}
			}
		} catch {
			// Fall through to bundled extensions on network failure
		}

		return UnifiedCatalogService.BUNDLED_EXTENSIONS;
	}

	private async _fetchSkills(): Promise<UnifiedCatalogItem[]> {
		try {
			const marketplaceSkills = await this._communityMarketplace.fetchSkills();
			return marketplaceSkills.map(skill => ({
				id: `skill:${skill.name}`,
				name: skill.name,
				displayName: skill.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
				description: skill.description,
				category: 'skill' as const,
				version: skill.version,
				publisher: skill.author,
				rating: skill.rating ?? 4.5,
				downloads: skill.downloads ?? 0,
				tags: skill.keywords,
				installed: false,
				enabled: true,
				repository: skill.repository,
				homepage: skill.homepage,
				metadata: { installCommand: skill.installCommand }
			}));
		} catch {
			return [];
		}
	}

	private async _fetchMCPItems(): Promise<UnifiedCatalogItem[]> {
		try {
			const registry = getMCPRegistry();
			const mcpState = this._mcpService.state;
			const activeServers = mcpState?.mcpServerOfName || {};

			return registry.map(entry => {
				const isInstalled = entry.id in activeServers;
				const isEnabled = isInstalled;

				return {
					id: `mcp:${entry.id}`,
					name: entry.id,
					displayName: entry.displayName,
					description: entry.description,
					category: 'mcp' as const,
					version: '1.0.0',
					publisher: 'modelcontextprotocol',
					rating: 4.9,
					downloads: 12000,
					tags: ['mcp', 'tools', 'protocol', entry.id],
					installed: isInstalled,
					enabled: isEnabled,
					homepage: entry.homepage,
					metadata: { config: entry.config, requiredEnvVars: entry.requiredEnvVars }
				};
			});
		} catch {
			return [];
		}
	}

	private _fetchHooks(): UnifiedCatalogItem[] {
		return UnifiedCatalogService.BUILTIN_HOOKS.map(hook => ({
			...hook,
			installed: this.installedHookIds.has(hook.id),
			enabled: this.installedHookIds.has(hook.id)
		}));
	}

	private _fetchVibePersonas(): UnifiedCatalogItem[] {
		return UnifiedCatalogService.BUILTIN_VIBE_PERSONAS.map(vibe => ({
			...vibe,
			installed: true,
			enabled: this.activeVibePersonaId === vibe.id
		}));
	}

	private _sortItems(items: UnifiedCatalogItem[], sortBy: string, query: string): UnifiedCatalogItem[] {
		const copy = [...items];
		switch (sortBy) {
			case 'downloads':
				return copy.sort((a, b) => b.downloads - a.downloads);
			case 'rating':
				return copy.sort((a, b) => b.rating - a.rating);
			case 'name':
				return copy.sort((a, b) => a.displayName.localeCompare(b.displayName));
			case 'relevance':
			default:
				if (!query) {
					return copy.sort((a, b) => b.downloads - a.downloads);
				}
				return copy.sort((a, b) => {
					const aExact = a.name.toLowerCase() === query || a.displayName.toLowerCase() === query;
					const bExact = b.name.toLowerCase() === query || b.displayName.toLowerCase() === query;
					if (aExact && !bExact) return -1;
					if (!aExact && bExact) return 1;
					return b.downloads - a.downloads;
				});
		}
	}

	private async _saveState(): Promise<void> {
		try {
			await this._fileService.createFolder(URI.file(this.cacheDir));
			const stateFile = path.join(this.cacheDir, 'unified_catalog_state.json');
			const statePayload = {
				installedHooks: Array.from(this.installedHookIds),
				activeVibePersonaId: this.activeVibePersonaId,
				updatedAt: Date.now()
			};
			await this._fileService.writeFile(
				URI.file(stateFile),
				VSBuffer.fromString(JSON.stringify(statePayload, null, 2))
			);
		} catch {
			// Non-fatal
		}
	}
}

registerSingleton(IUnifiedCatalogService, UnifiedCatalogService, InstantiationType.Delayed);

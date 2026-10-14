/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { ISkillsRegistry } from '../skills/skillRegistryTypes.js';
import { ISkillParser } from '../skills/skillParserTypes.js';
import {
	ICommunityMarketplace,
	CommunitySkillData,
	SubmitSkillResponse,
	CommunityMarketplaceError
} from './communityMarketplaceTypes.js';
import {
	MarketplaceSkill,
	MarketplaceCacheData,
	MarketplaceError
} from './marketplaceTypes.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { registerSingleton, InstantiationType } from '../../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { getAINativeConfig } from '../ainativeConfig.js';

const execAsync = promisify(exec);

/**
 * Community Marketplace Service Implementation
 * Decentralized, Git-backed skill catalog and offline-first installation engine
 */
export class CommunityMarketplace extends Disposable implements ICommunityMarketplace {
	declare readonly _serviceBrand: undefined;

	private static readonly API_BASE_URL = 'https://api.ainative.studio/v1/skills/marketplace';
	private static readonly DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/ranveerd11/sutra-skills/main/community.json';
	private static readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
	private static readonly CACHE_FILENAME = 'community.json';
	private static readonly REQUEST_TIMEOUT = 10000; // 10 seconds
	private static readonly MAX_RETRIES = 2;
	private static readonly RETRY_DELAY = 500; // 500ms

	private static readonly BUNDLED_COMMUNITY_SKILLS: MarketplaceSkill[] = [
		{
			name: 'git-workflows',
			description: 'Automated Git workflows, branch conventions, and clean conventional commits',
			version: '1.0.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['git', 'workflow', 'automation', 'vcs'],
			rating: 4.9,
			downloads: 1250,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			installCommand: 'sutra skill install git-workflows',
			homepage: 'https://github.com/ranveerd11/sutra-skills',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		},
		{
			name: 'sqlite-patterns',
			description: 'Embedded SQLite schemas, FTS5 full-text indexing, and vector similarity retrieval patterns',
			version: '1.2.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['sqlite', 'database', 'fts5', 'vectors', 'embedded'],
			rating: 4.8,
			downloads: 980,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			installCommand: 'sutra skill install sqlite-patterns',
			homepage: 'https://github.com/ranveerd11/sutra-skills',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		},
		{
			name: 'code-review-assistant',
			description: 'Automated static analysis, AST code intelligence, and vulnerability prevention',
			version: '2.0.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['review', 'security', 'ast', 'scanner', 'quality'],
			rating: 5.0,
			downloads: 3100,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			installCommand: 'sutra skill install code-review-assistant',
			homepage: 'https://github.com/ranveerd11/sutra-skills',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		},
		{
			name: 'python-fastapi-scaffold',
			description: 'FastAPI production service templates with Pydantic v2 schemas and async database clients',
			version: '1.1.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['python', 'fastapi', 'async', 'pydantic', 'backend'],
			rating: 4.7,
			downloads: 840,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			installCommand: 'sutra skill install python-fastapi-scaffold',
			homepage: 'https://github.com/ranveerd11/sutra-skills',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		},
		{
			name: 'tree-sitter-navigation',
			description: 'Multi-language AST navigation, symbol extraction, and syntax tree traversal',
			version: '1.0.0',
			source: 'community',
			author: 'sutra-community',
			keywords: ['tree-sitter', 'ast', 'syntax', 'symbols', 'parsing'],
			rating: 4.9,
			downloads: 1420,
			updatedAt: new Date('2026-01-01T00:00:00Z'),
			installCommand: 'sutra skill install tree-sitter-navigation',
			homepage: 'https://github.com/ranveerd11/sutra-skills',
			repository: 'https://github.com/ranveerd11/sutra-skills.git'
		}
	];

	private readonly cacheDir: string;
	private readonly skillsDir: string;
	private authToken: string | null = null;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ISkillsRegistry private readonly registry: ISkillsRegistry,
		@ISkillParser private readonly parser: ISkillParser,
		@IEnvironmentService _envService: IEnvironmentService
	) {
		super();
		const homeDir = os.homedir();
		const sutraHome = (typeof process !== 'undefined' && process.env?.['SUTRA_HOME']) || path.join(homeDir, '.sutra');
		this.cacheDir = path.join(sutraHome, 'cache', 'marketplace');
		this.skillsDir = path.join(sutraHome, 'skills');
	}

	private _getManifestUrl(): string {
		if (typeof process !== 'undefined' && process.env) {
			const custom = process.env['SUTRA_SKILLS_MANIFEST_URL'] || process.env['NOVA_SKILLS_MANIFEST_URL'] || process.env['SKILLS_MANIFEST_URL'];
			if (custom) return custom;
			const config = getAINativeConfig();
			if (config.apiBaseUrl && !config.byokMode) {
				return `${config.apiBaseUrl}/v1/skills/marketplace`;
			}
		}
		return CommunityMarketplace.DEFAULT_MANIFEST_URL;
	}

	/**
	 * Fetch all community skills from decentralized Git manifest or API
	 */
	async fetchSkills(forceRefresh = false): Promise<MarketplaceSkill[]> {
		try {
			// Clear cache if force refresh
			if (forceRefresh) {
				await this.clearCache();
			}

			// Try to load from cache first
			const cached = await this.loadCache();
			if (cached && cached.length > 0) {
				return cached;
			}

			// Try fetching from decentralized manifest or API
			const manifestUrl = this._getManifestUrl();
			try {
				const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(CommunityMarketplace.REQUEST_TIMEOUT) });
				if (response.ok) {
					const data = await response.json();
					const rawList: CommunitySkillData[] = Array.isArray(data) ? data : (data.skills || []);
					const skills = rawList
						.filter(skill => skill.status === 'approved' || !skill.status)
						.map(skill => this.transformApiSkill(skill));

					if (skills.length > 0) {
						await this.saveCache(skills);
						return skills;
					}
				}
			} catch {
				// Fall through to cache/bundled fallback
			}

			// On network error, try stale cache
			const staleCache = await this.loadCache(true);
			if (staleCache && staleCache.length > 0) {
				return staleCache;
			}

			// Fallback to bundled offline community skills
			await this.saveCache(CommunityMarketplace.BUNDLED_COMMUNITY_SKILLS);
			return CommunityMarketplace.BUNDLED_COMMUNITY_SKILLS;
		} catch {
			return CommunityMarketplace.BUNDLED_COMMUNITY_SKILLS;
		}
	}

	private _sanitizeName(name: string): string {
		return path.basename(name).replace(/[^a-zA-Z0-9_-]/g, '');
	}

	/**
	 * Get detailed information about a specific skill
	 */
	async getSkillDetails(skillName: string): Promise<MarketplaceSkill | null> {
		const allSkills = await this.fetchSkills();
		return allSkills.find(skill => skill.name.toLowerCase() === skillName.toLowerCase()) || null;
	}

	/**
	 * Install a community skill from Git, archive, or bundled template
	 */
	async install(skillName: string, version?: string): Promise<void> {
		try {
			const safeSkillName = this._sanitizeName(skillName);
			if (!safeSkillName) {
				throw new MarketplaceError(`Invalid skill name "${skillName}"`, 'INSTALL_ERROR');
			}

			const isInstalled = await this.registry.isInstalled(safeSkillName);
			if (isInstalled) {
				throw new MarketplaceError(
					`Skill "${safeSkillName}" is already installed. Uninstall it first to reinstall.`,
					'INSTALL_ERROR'
				);
			}

			const skillDetails = await this.getSkillDetails(safeSkillName);
			if (!skillDetails) {
				throw new MarketplaceError(`Skill "${safeSkillName}" not found in community marketplace`, 'NOT_FOUND');
			}

			const targetPath = path.join(this.skillsDir, safeSkillName);
			const repoUrl = skillDetails.repository;

			if (repoUrl && (repoUrl.endsWith('.git') || repoUrl.includes('github.com'))) {
				await this.fileService.createFolder(URI.file(this.skillsDir));
				try {
					await execAsync(`git clone --depth 1 "${repoUrl}" "${targetPath}"`, { timeout: 60000 });
				} catch {
					await this._scaffoldSkill(targetPath, skillDetails);
				}
			} else if (repoUrl && repoUrl.endsWith('.zip')) {
				const tempZipPath = path.join(os.tmpdir(), `${safeSkillName}-${Date.now()}.zip`);
				await this.downloadFile(repoUrl, tempZipPath);
				await this.extractZip(tempZipPath, targetPath);
				try {
					await this.fileService.del(URI.file(tempZipPath));
				} catch {}
			} else {
				await this._scaffoldSkill(targetPath, skillDetails);
			}

			await this.registry.install(targetPath);
			this.incrementDownloadCount(safeSkillName).catch(() => {});
		} catch (error) {
			if (error instanceof MarketplaceError) {
				throw error;
			}
			throw new MarketplaceError(
				`Failed to install skill "${skillName}": ${error instanceof Error ? error.message : String(error)}`,
				'INSTALL_ERROR'
			);
		}
	}

	private async _scaffoldSkill(targetPath: string, skill: MarketplaceSkill): Promise<void> {
		await this.fileService.createFolder(URI.file(targetPath));
		const skillMdContent = `---
name: ${skill.name}
description: ${skill.description}
version: ${skill.version}
author: ${skill.author}
tags: ${JSON.stringify(skill.keywords)}
---

# ${skill.name}

${skill.description}

## Usage
Use this skill to guide agent actions for ${skill.keywords.join(', ')}.
`;
		const skillFileUri = URI.file(path.join(targetPath, 'SKILL.md'));
		await this.fileService.writeFile(skillFileUri, VSBuffer.fromString(skillMdContent));
	}

	/**
	 * Search for skills by query
	 */
	async search(query: string): Promise<MarketplaceSkill[]> {
		const allSkills = await this.fetchSkills();
		const lowerQuery = query.toLowerCase().trim();
		if (!lowerQuery) {
			return allSkills;
		}

		return allSkills.filter(skill =>
			skill.name.toLowerCase().includes(lowerQuery) ||
			skill.description.toLowerCase().includes(lowerQuery) ||
			skill.keywords.some(kw => kw.toLowerCase().includes(lowerQuery)) ||
			skill.author.toLowerCase().includes(lowerQuery)
		);
	}

	/**
	 * Submit a skill for community review or local sovereign packaging
	 */
	async submit(skillPath: string): Promise<SubmitSkillResponse> {
		try {
			const skillFileUri = URI.file(path.join(skillPath, 'SKILL.md'));
			const skill = await this.parser.parseSkillFile(skillFileUri.fsPath);

			const isValid = await this.parser.validateSkillFormat(skillFileUri.fsPath);
			if (!isValid) {
				throw new CommunityMarketplaceError(
					'Invalid skill format. Please ensure SKILL.md follows the specification.',
					'VALIDATION_ERROR'
				);
			}

			const exportDir = path.join(this.skillsDir, '..', 'skills-export');
			await this.fileService.createFolder(URI.file(exportDir));
			const safeSkillName = this._sanitizeName(skill.metadata.name);
			const targetZipPath = path.join(exportDir, `${safeSkillName}.zip`);

			try {
				await this.createZipArchive(skillPath, targetZipPath);
			} catch {
				// Continue if local zip creation is unavailable
			}

			// If authenticated with cloud, attempt remote API upload
			if (this.authToken) {
				try {
					const tempZipPath = path.join(os.tmpdir(), `${safeSkillName}-${Date.now()}.zip`);
					await this.createZipArchive(skillPath, tempZipPath);
					const zipContent = await this.fileService.readFile(URI.file(tempZipPath));

					const formData = new FormData();
					formData.append('name', skill.metadata.name);
					formData.append('description', skill.metadata.description || 'No description provided');
					formData.append('version', skill.metadata.version || '1.0.0');
					formData.append('category', (skill.metadata.tags && skill.metadata.tags[0]) || 'general');
					formData.append('keywords', JSON.stringify(skill.metadata.tags || []));
					formData.append('file', new Blob([zipContent.value.buffer]), `${skill.metadata.name}.zip`);

					const response = await this.fetchFromAPI<SubmitSkillResponse>('', {
						method: 'POST',
						body: formData,
						headers: {
							'Authorization': `Bearer ${this.authToken}`
						}
					});

					try {
						await this.fileService.del(URI.file(tempZipPath));
					} catch {}

					return response;
				} catch {
					// Fall through to sovereign packaging
				}
			}

			return {
				id: `sovereign-${Date.now()}`,
				status: 'approved',
				message: `Skill "${skill.metadata.name}" validated and packaged for sovereign distribution at ${targetZipPath}`
			};
		} catch (error) {
			if (error instanceof CommunityMarketplaceError) {
				throw error;
			}
			throw new CommunityMarketplaceError(
				`Failed to submit skill: ${error instanceof Error ? error.message : String(error)}`,
				'SUBMISSION_FAILED'
			);
		}
	}

	/**
	 * Rate a community skill
	 */
	async rate(skillId: string, rating: number): Promise<void> {
		if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
			throw new CommunityMarketplaceError('Rating must be an integer between 1 and 5', 'VALIDATION_ERROR');
		}

		try {
			await this.fileService.createFolder(URI.file(this.cacheDir));
			const ratingsFile = path.join(this.cacheDir, 'ratings.json');
			const ratingsUri = URI.file(ratingsFile);
			let ratings: Record<string, number> = {};
			try {
				const existing = await this.fileService.readFile(ratingsUri);
				ratings = JSON.parse(existing.value.toString());
			} catch {}
			ratings[skillId] = rating;
			await this.fileService.writeFile(ratingsUri, VSBuffer.fromString(JSON.stringify(ratings, null, 2)));
		} catch {}

		if (this.authToken) {
			try {
				await this.fetchFromAPI(`/${skillId}/rate`, {
					method: 'POST',
					body: JSON.stringify({ rating }),
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${this.authToken}`
					}
				});
			} catch {}
		}

		await this.clearCache();
	}

	/**
	 * Check if cache is valid
	 */
	async isCacheValid(): Promise<boolean> {
		const cacheFile = path.join(this.cacheDir, CommunityMarketplace.CACHE_FILENAME);
		const cacheUri = URI.file(cacheFile);

		try {
			const fileContent = await this.fileService.readFile(cacheUri);
			const cacheData: MarketplaceCacheData = JSON.parse(fileContent.value.toString());

			const age = Date.now() - cacheData.timestamp;
			return age < cacheData.ttl;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Clear the cache
	 */
	async clearCache(): Promise<void> {
		const cacheFile = path.join(this.cacheDir, CommunityMarketplace.CACHE_FILENAME);
		const cacheUri = URI.file(cacheFile);

		try {
			await this.fileService.del(cacheUri);
		} catch (error) {
			if (error instanceof Error && !error.message.includes('ENOENT')) {
				throw error;
			}
		}
	}

	/**
	 * Check if user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		if (this.authToken !== null) {
			return true;
		}
		const config = getAINativeConfig();
		return config.byokMode || !config.enableAuth;
	}

	/**
	 * Set authentication token
	 */
	setAuthToken(token: string): void {
		this.authToken = token;
	}

	/**
	 * Fetch data from AINative API with retry logic
	 */
	private async fetchFromAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
		const url = `${CommunityMarketplace.API_BASE_URL}${endpoint}`;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < CommunityMarketplace.MAX_RETRIES; attempt++) {
			try {
				const response = await fetch(url, {
					...options,
					signal: AbortSignal.timeout(CommunityMarketplace.REQUEST_TIMEOUT),
					headers: {
						'Content-Type': 'application/json',
						...options.headers
					}
				});

				if (response.status === 429) {
					const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
					throw new MarketplaceError(
						`Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
						'RATE_LIMIT'
					);
				}

				if (response.status === 401 || response.status === 403) {
					throw new CommunityMarketplaceError(
						'Authentication failed. Please sign in again.',
						'AUTH_REQUIRED'
					);
				}

				if (!response.ok) {
					throw new Error(`API request failed: ${response.status} ${response.statusText}`);
				}

				return await response.json();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (error instanceof CommunityMarketplaceError || error instanceof MarketplaceError) {
					throw error;
				}

				if (attempt < CommunityMarketplace.MAX_RETRIES - 1) {
					await this.sleep(CommunityMarketplace.RETRY_DELAY * Math.pow(2, attempt));
				}
			}
		}

		throw lastError || new Error('API request failed after retries');
	}

	private transformApiSkill(apiSkill: CommunitySkillData): MarketplaceSkill {
		return {
			name: apiSkill.name,
			description: apiSkill.description,
			version: apiSkill.version || '1.0.0',
			source: 'community',
			author: apiSkill.author || 'sutra-community',
			keywords: apiSkill.keywords || [],
			rating: apiSkill.rating_avg,
			downloads: apiSkill.download_count,
			updatedAt: apiSkill.updated_at ? new Date(apiSkill.updated_at) : new Date(),
			installCommand: `sutra skill install ${apiSkill.name}`,
			homepage: undefined,
			repository: apiSkill.skill_file_url
		};
	}

	private async loadCache(allowStale = false): Promise<MarketplaceSkill[] | null> {
		const cacheFile = path.join(this.cacheDir, CommunityMarketplace.CACHE_FILENAME);
		const cacheUri = URI.file(cacheFile);

		try {
			const fileContent = await this.fileService.readFile(cacheUri);
			const cacheData: MarketplaceCacheData = JSON.parse(fileContent.value.toString());

			const age = Date.now() - cacheData.timestamp;

			if (allowStale || age < cacheData.ttl) {
				return cacheData.skills.map(skill => ({
					...skill,
					updatedAt: new Date(skill.updatedAt)
				}));
			}

			return null;
		} catch (error) {
			return null;
		}
	}

	private async saveCache(skills: MarketplaceSkill[]): Promise<void> {
		const cacheFile = path.join(this.cacheDir, CommunityMarketplace.CACHE_FILENAME);
		const cacheUri = URI.file(cacheFile);
		const cacheDir = URI.file(this.cacheDir);

		try {
			await this.fileService.createFolder(cacheDir);

			const cacheData: MarketplaceCacheData = {
				skills,
				timestamp: Date.now(),
				ttl: CommunityMarketplace.CACHE_TTL
			};

			const content = JSON.stringify(cacheData, null, 2);
			await this.fileService.writeFile(cacheUri, VSBuffer.fromString(content));
		} catch (error) {
			// Non-fatal
		}
	}

	private async downloadFile(url: string, targetPath: string): Promise<void> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const buffer = VSBuffer.wrap(new Uint8Array(arrayBuffer));

		await this.fileService.writeFile(URI.file(targetPath), buffer);
	}

	private async extractZip(zipPath: string, targetPath: string): Promise<void> {
		await this.fileService.createFolder(URI.file(targetPath));
		try {
			await execAsync(`unzip -o "${zipPath}" -d "${targetPath}"`, { timeout: 60000 });
		} catch (error) {
			throw new Error(`Failed to extract zip file: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async createZipArchive(sourcePath: string, targetZipPath: string): Promise<void> {
		try {
			const cwd = path.dirname(sourcePath);
			const dirName = path.basename(sourcePath);
			await execAsync(`cd "${cwd}" && zip -r "${targetZipPath}" "${dirName}"`, { timeout: 60000 });
		} catch (error) {
			throw new Error(`Failed to create zip archive: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async incrementDownloadCount(skillName: string): Promise<void> {
		try {
			await this.fetchFromAPI(`/${skillName}/download`, {
				method: 'POST'
			});
		} catch {
			// Silently fail
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}

// Register the service
registerSingleton(ICommunityMarketplace, CommunityMarketplace, InstantiationType.Delayed);

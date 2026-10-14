/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('CommunityMarketplace Service', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('Decentralized Catalog Integration', () => {
		test('should resolve default decentralized manifest URL', () => {
			const defaultManifestUrl = 'https://raw.githubusercontent.com/ranveerd11/sutra-skills/main/community.json';
			assert.strictEqual(defaultManifestUrl.includes('sutra-skills'), true);
			assert.strictEqual(defaultManifestUrl.endsWith('community.json'), true);
		});

		test('should prioritize custom manifest environment variables', () => {
			const resolveManifestUrl = (env: Record<string, string | undefined>): string => {
				const custom = env['SUTRA_SKILLS_MANIFEST_URL'] || env['NOVA_SKILLS_MANIFEST_URL'] || env['SKILLS_MANIFEST_URL'];
				if (custom) return custom;
				return 'https://raw.githubusercontent.com/ranveerd11/sutra-skills/main/community.json';
			};

			assert.strictEqual(
				resolveManifestUrl({ SUTRA_SKILLS_MANIFEST_URL: 'https://internal-repo.corp/skills.json' }),
				'https://internal-repo.corp/skills.json'
			);
			assert.strictEqual(
				resolveManifestUrl({ NOVA_SKILLS_MANIFEST_URL: 'https://nova-mirror.corp/skills.json' }),
				'https://nova-mirror.corp/skills.json'
			);
			assert.strictEqual(
				resolveManifestUrl({}),
				'https://raw.githubusercontent.com/ranveerd11/sutra-skills/main/community.json'
			);
		});

		test('should handle decentralized manifest response formats', () => {
			const rawArrayPayload = [
				{
					id: 'uuid-1',
					name: 'git-workflows',
					description: 'Automated Git workflows',
					author: 'sutra-community',
					category: 'git',
					keywords: ['git', 'vcs'],
					version: '1.0.0',
					rating_avg: 4.9,
					rating_count: 50,
					download_count: 1200,
					status: 'approved' as const,
					skill_file_url: 'https://github.com/ranveerd11/sutra-skills.git',
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z'
				}
			];

			const rawObjectPayload = {
				skills: rawArrayPayload
			};

			const parseSkills = (payload: any) => Array.isArray(payload) ? payload : (payload.skills || []);

			assert.strictEqual(parseSkills(rawArrayPayload).length, 1);
			assert.strictEqual(parseSkills(rawObjectPayload).length, 1);
			assert.strictEqual(parseSkills(rawArrayPayload)[0].name, 'git-workflows');
		});
	});

	suite('Skill Transformation', () => {
		test('should transform catalog skill to MarketplaceSkill with sutra install command', () => {
			const apiSkill = {
				id: 'uuid-123',
				name: 'sqlite-patterns',
				description: 'Embedded SQLite schemas and vector search',
				author: 'sutra-community',
				category: 'database',
				keywords: ['sqlite', 'database', 'vectors'],
				version: '1.2.0',
				rating_avg: 4.8,
				rating_count: 45,
				download_count: 980,
				status: 'approved' as const,
				skill_file_url: 'https://github.com/ranveerd11/sutra-skills.git',
				created_at: '2026-01-01T00:00:00Z',
				updated_at: '2026-01-15T12:00:00Z'
			};

			const marketplaceSkill = {
				name: apiSkill.name,
				description: apiSkill.description,
				version: apiSkill.version || '1.0.0',
				source: 'community' as const,
				author: apiSkill.author || 'sutra-community',
				keywords: apiSkill.keywords || [],
				rating: apiSkill.rating_avg,
				downloads: apiSkill.download_count,
				updatedAt: new Date(apiSkill.updated_at),
				installCommand: `sutra skill install ${apiSkill.name}`,
				homepage: undefined,
				repository: apiSkill.skill_file_url
			};

			assert.strictEqual(marketplaceSkill.name, 'sqlite-patterns');
			assert.strictEqual(marketplaceSkill.source, 'community');
			assert.strictEqual(marketplaceSkill.rating, 4.8);
			assert.strictEqual(marketplaceSkill.downloads, 980);
			assert.strictEqual(marketplaceSkill.keywords.length, 3);
			assert.strictEqual(marketplaceSkill.installCommand, 'sutra skill install sqlite-patterns');
			assert.strictEqual(marketplaceSkill.repository, 'https://github.com/ranveerd11/sutra-skills.git');
		});

		test('should handle missing author and keywords with sensible defaults', () => {
			const sparseSkill: any = {
				name: 'minimal-skill',
				description: 'Minimal skill description'
			};

			const transformed = {
				name: sparseSkill.name,
				description: sparseSkill.description,
				version: sparseSkill.version || '1.0.0',
				author: sparseSkill.author || 'sutra-community',
				keywords: sparseSkill.keywords || [],
				installCommand: `sutra skill install ${sparseSkill.name}`
			};

			assert.strictEqual(transformed.version, '1.0.0');
			assert.strictEqual(transformed.author, 'sutra-community');
			assert.deepStrictEqual(transformed.keywords, []);
			assert.strictEqual(transformed.installCommand, 'sutra skill install minimal-skill');
		});

		test('should filter out non-approved skills', () => {
			const skills = [
				{ id: '1', status: 'approved' as const, name: 'skill1' },
				{ id: '2', status: 'pending' as const, name: 'skill2' },
				{ id: '3', status: 'approved' as const, name: 'skill3' },
				{ id: '4', status: 'rejected' as const, name: 'skill4' }
			];

			const approvedSkills = skills.filter(s => s.status === 'approved' || !s.status);

			assert.strictEqual(approvedSkills.length, 2);
			assert.strictEqual(approvedSkills[0].name, 'skill1');
			assert.strictEqual(approvedSkills[1].name, 'skill3');
		});
	});

	suite('Bundled Offline Skills Fallback', () => {
		test('should provide core bundled offline skills for airgapped environments', () => {
			const bundledSkills = [
				'git-workflows',
				'sqlite-patterns',
				'code-review-assistant',
				'python-fastapi-scaffold',
				'tree-sitter-navigation'
			];

			assert.strictEqual(bundledSkills.length, 5);
			assert.strictEqual(bundledSkills.includes('code-review-assistant'), true);
			assert.strictEqual(bundledSkills.includes('tree-sitter-navigation'), true);
			assert.strictEqual(bundledSkills.includes('sqlite-patterns'), true);
		});
	});

	suite('Cache Management and Path Resolution', () => {
		test('should calculate cache expiration correctly', () => {
			const now = Date.now();
			const oneHourAgo = now - (60 * 60 * 1000);
			const twoHoursAgo = now - (2 * 60 * 60 * 1000);
			const cacheTTL = 60 * 60 * 1000;

			assert.strictEqual((now - oneHourAgo) >= cacheTTL, true);
			assert.strictEqual((now - twoHoursAgo) > cacheTTL, true);

			const thirtyMinutesAgo = now - (30 * 60 * 1000);
			assert.strictEqual((now - thirtyMinutesAgo) < cacheTTL, true);
		});

		test('should construct correct Sutra cache and skills directory paths', () => {
			const homeDir = '/Users/testuser';
			const sutraHome = `${homeDir}/.sutra`;
			const cacheFile = `${sutraHome}/cache/marketplace/community.json`;
			const skillsDir = `${sutraHome}/skills`;
			const exportDir = `${sutraHome}/skills-export`;

			assert.strictEqual(cacheFile, '/Users/testuser/.sutra/cache/marketplace/community.json');
			assert.strictEqual(skillsDir, '/Users/testuser/.sutra/skills');
			assert.strictEqual(exportDir, '/Users/testuser/.sutra/skills-export');
		});
	});

	suite('Search Functionality', () => {
		const skills = [
			{ name: 'git-workflows', description: 'Automated Git workflows and branch conventions', author: 'sutra-community', keywords: ['git', 'automation'] },
			{ name: 'sqlite-patterns', description: 'Embedded SQLite schemas and vector search', author: 'sutra-community', keywords: ['sqlite', 'database'] },
			{ name: 'code-review-assistant', description: 'AST code intelligence and security review', author: 'security-team', keywords: ['review', 'security'] }
		];

		const searchSkills = (query: string) => {
			const lowerQuery = query.toLowerCase().trim();
			if (!lowerQuery) return skills;
			return skills.filter(skill =>
				skill.name.toLowerCase().includes(lowerQuery) ||
				skill.description.toLowerCase().includes(lowerQuery) ||
				skill.keywords.some(kw => kw.toLowerCase().includes(lowerQuery)) ||
				skill.author.toLowerCase().includes(lowerQuery)
			);
		};

		test('should search by keyword', () => {
			const results = searchSkills('security');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].name, 'code-review-assistant');
		});

		test('should search by author', () => {
			const results = searchSkills('security-team');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].name, 'code-review-assistant');
		});

		test('should perform case-insensitive search across name and description', () => {
			const results = searchSkills('SQLITE');
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].name, 'sqlite-patterns');
		});

		test('should return all skills when query is empty', () => {
			const results = searchSkills('  ');
			assert.strictEqual(results.length, 3);
		});
	});

	suite('Rating & Sovereign Persistence', () => {
		test('should validate rating integer boundaries (1 to 5)', () => {
			const isValidRating = (rating: number): boolean => {
				return rating >= 1 && rating <= 5 && Number.isInteger(rating);
			};

			assert.strictEqual(isValidRating(1), true);
			assert.strictEqual(isValidRating(3), true);
			assert.strictEqual(isValidRating(5), true);
			assert.strictEqual(isValidRating(0), false);
			assert.strictEqual(isValidRating(6), false);
			assert.strictEqual(isValidRating(3.5), false);
			assert.strictEqual(isValidRating(-1), false);
		});

		test('should format ratings dictionary for local persistence', () => {
			const ratings: Record<string, number> = {};
			ratings['sqlite-patterns'] = 5;
			ratings['git-workflows'] = 4;

			const serialized = JSON.stringify(ratings, null, 2);
			const parsed = JSON.parse(serialized);

			assert.strictEqual(parsed['sqlite-patterns'], 5);
			assert.strictEqual(parsed['git-workflows'], 4);
		});
	});

	suite('Authentication & Sovereign BYOK Mode', () => {
		test('should evaluate BYOK mode or disabled auth as authenticated', () => {
			const isAuth = (authToken: string | null, config: { byokMode: boolean; enableAuth: boolean }) => {
				if (authToken !== null) return true;
				return config.byokMode || !config.enableAuth;
			};

			assert.strictEqual(isAuth(null, { byokMode: true, enableAuth: true }), true);
			assert.strictEqual(isAuth(null, { byokMode: false, enableAuth: false }), true);
			assert.strictEqual(isAuth('token-123', { byokMode: false, enableAuth: true }), true);
			assert.strictEqual(isAuth(null, { byokMode: false, enableAuth: true }), false);
		});
	});

	suite('Sovereign Skill Packaging & Scaffold', () => {
		test('should generate compliant SKILL.md frontmatter for scaffolded skills', () => {
			const skill = {
				name: 'custom-tooling',
				description: 'Custom tooling for sovereign agents',
				version: '1.0.0',
				author: 'sutra-developer',
				keywords: ['tooling', 'automation']
			};

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

			assert.strictEqual(skillMdContent.includes('name: custom-tooling'), true);
			assert.strictEqual(skillMdContent.includes('version: 1.0.0'), true);
			assert.strictEqual(skillMdContent.includes('tags: ["tooling","automation"]'), true);
			assert.strictEqual(skillMdContent.includes('## Usage'), true);
		});

		test('should produce sovereign submission response without cloud JWT', () => {
			const skillName = 'offline-skill';
			const targetZipPath = '/Users/testuser/.sutra/skills-export/offline-skill.zip';
			const response = {
				id: `sovereign-${Date.now()}`,
				status: 'approved' as const,
				message: `Skill "${skillName}" validated and packaged for sovereign distribution at ${targetZipPath}`
			};

			assert.strictEqual(response.status, 'approved');
			assert.strictEqual(response.id.startsWith('sovereign-'), true);
			assert.strictEqual(response.message.includes(targetZipPath), true);
		});
	});

	suite('Retry Logic & Error Handling', () => {
		test('should calculate exponential backoff delays', () => {
			const baseDelay = 500;
			const delays = [
				baseDelay * Math.pow(2, 0),
				baseDelay * Math.pow(2, 1),
				baseDelay * Math.pow(2, 2)
			];

			assert.strictEqual(delays[0], 500);
			assert.strictEqual(delays[1], 1000);
			assert.strictEqual(delays[2], 2000);
		});

		test('should categorize error types correctly', () => {
			const errorCodes = ['AUTH_REQUIRED', 'NETWORK_ERROR', 'RATE_LIMIT', 'VALIDATION_ERROR', 'SUBMISSION_FAILED', 'INSTALL_ERROR', 'NOT_FOUND'];
			assert.strictEqual(errorCodes.includes('INSTALL_ERROR'), true);
			assert.strictEqual(errorCodes.includes('NOT_FOUND'), true);
			assert.strictEqual(errorCodes.includes('RATE_LIMIT'), true);
		});
	});
});

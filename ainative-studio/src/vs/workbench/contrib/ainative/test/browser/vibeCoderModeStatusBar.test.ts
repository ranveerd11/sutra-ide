/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import { MenuRegistry, MenuId } from '../../../../../platform/actions/common/actions.js';
import { IStatusbarService, IStatusbarEntry, IStatusbarEntryAccessor, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { IAINativeSettingsService } from '../../common/ainativeSettingsService.js';
import { IUnifiedCatalogService } from '../../common/marketplace/unifiedCatalogTypes.js';
import {
	VibeCoderModeStatusBarContribution
} from '../../browser/vibeCoderModeStatusBar.js';
import {
	SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID,
	SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID,
	SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID
} from '../../browser/actionIDs.js';

suite('Vibe Coder Mode Ambient HUD & Status Bar', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should have registered Vibe command palette actions', () => {
		const menuItems = MenuRegistry.getMenuItems(MenuId.CommandPalette);

		const switchPersonaItem = menuItems.find(item =>
			'command' in item && item.command.id === SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID
		);
		const toggleSkillsItem = menuItems.find(item =>
			'command' in item && item.command.id === SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID
		);
		const sandboxStatusItem = menuItems.find(item =>
			'command' in item && item.command.id === SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID
		);

		assert.ok(switchPersonaItem !== undefined);
		assert.ok(toggleSkillsItem !== undefined);
		assert.ok(sandboxStatusItem !== undefined);
	});

	suite('VibeCoderModeStatusBarContribution Lifecycle', () => {
		let onDidChangeSettingsEmitter: Emitter<void>;
		let onDidCatalogChangeEmitter: Emitter<void>;
		let mockStatusbarService: Partial<IStatusbarService>;
		let mockSettingsService: Partial<IAINativeSettingsService>;
		let mockCatalogService: Partial<IUnifiedCatalogService>;
		let statusEntries: Map<string, IStatusbarEntry>;
		let contribution: VibeCoderModeStatusBarContribution;

		setup(() => {
			onDidChangeSettingsEmitter = new Emitter<void>();
			onDidCatalogChangeEmitter = new Emitter<void>();
			statusEntries = new Map<string, IStatusbarEntry>();

			mockStatusbarService = {
				addEntry: (entry: IStatusbarEntry, id: string, _alignment: StatusbarAlignment, _priority?: any): IStatusbarEntryAccessor => {
					statusEntries.set(id, entry);
					return {
						update: (newEntry: IStatusbarEntry) => {
							statusEntries.set(id, newEntry);
						},
						dispose: () => {
							statusEntries.delete(id);
						}
					};
				}
			};

			mockSettingsService = {
				state: {
					globalSettings: {
						isVibeCoderMode: true
					}
				} as any,
				onDidChangeState: onDidChangeSettingsEmitter.event
			};

			mockCatalogService = {
				onDidCatalogChange: onDidCatalogChangeEmitter.event,
				queryCatalog: async (q) => {
					if (q?.category === 'vibe') {
						return {
							items: [
								{
									id: 'vibe:architect',
									name: 'vibe-architect',
									displayName: 'Systems Architect Persona',
									description: 'Systems design',
									category: 'vibe',
									version: '1.0.0',
									publisher: 'sutra-vibe',
									rating: 5.0,
									downloads: 5000,
									tags: [],
									installed: true,
									enabled: true
								}
							],
							total: 1,
							categoryCounts: { extension: 0, skill: 0, mcp: 0, hook: 0, vibe: 1 }
						};
					}
					if (q?.category === 'skill') {
						return {
							items: [
								{
									id: 'skill:testing',
									name: 'testing',
									displayName: 'Unit Testing Skill',
									description: 'Automated test suite generator',
									category: 'skill',
									version: '1.0.0',
									publisher: 'community',
									rating: 4.8,
									downloads: 1200,
									tags: [],
									installed: true,
									enabled: true
								},
								{
									id: 'skill:docs',
									name: 'docs',
									displayName: 'Docstring Generator',
									description: 'Documentation generator',
									category: 'skill',
									version: '1.0.0',
									publisher: 'community',
									rating: 4.7,
									downloads: 900,
									tags: [],
									installed: true,
									enabled: true
								}
							],
							total: 2,
							categoryCounts: { extension: 0, skill: 2, mcp: 0, hook: 0, vibe: 0 }
						};
					}
					return {
						items: [],
						total: 0,
						categoryCounts: { extension: 0, skill: 0, mcp: 0, hook: 0, vibe: 0 }
					};
				}
			};

			contribution = new VibeCoderModeStatusBarContribution(
				mockStatusbarService as IStatusbarService,
				mockSettingsService as IAINativeSettingsService,
				mockCatalogService as IUnifiedCatalogService
			);
		});

		teardown(() => {
			contribution.dispose();
			onDidChangeSettingsEmitter.dispose();
			onDidCatalogChangeEmitter.dispose();
		});

		test('should mount ambient status bar items when Vibe Coder Mode is enabled', async () => {
			// Allow async catalog query in constructor
			await new Promise(r => setTimeout(r, 10));

			assert.ok(statusEntries.has('sutra.vibe.persona'));
			assert.ok(statusEntries.has('sutra.vibe.skills'));
			assert.ok(statusEntries.has('sutra.vibe.sandbox'));
			assert.ok(statusEntries.has('sutra.vibe.marketplace'));

			const personaEntry = statusEntries.get('sutra.vibe.persona');
			assert.ok(personaEntry?.text.includes('Systems Architect'));

			const skillsEntry = statusEntries.get('sutra.vibe.skills');
			assert.ok(skillsEntry?.text.includes('2 Skills'));
		});

		test('should update sandbox status dynamically', async () => {
			await new Promise(r => setTimeout(r, 10));
			contribution.updateSandboxStatus('Passing (10/10)');
			const sandboxEntry = statusEntries.get('sutra.vibe.sandbox');
			assert.ok(sandboxEntry?.text.includes('Passing (10/10)'));
		});

		test('should tear down status bar items when exiting Vibe Coder Mode', async () => {
			await new Promise(r => setTimeout(r, 10));
			assert.strictEqual(statusEntries.size, 4);

			// Disable Vibe mode
			(mockSettingsService.state!.globalSettings as any).isVibeCoderMode = false;
			onDidChangeSettingsEmitter.fire();

			assert.strictEqual(statusEntries.size, 0);
			assert.ok(!statusEntries.has('sutra.vibe.persona'));
			assert.ok(!statusEntries.has('sutra.vibe.skills'));
		});
	});
});

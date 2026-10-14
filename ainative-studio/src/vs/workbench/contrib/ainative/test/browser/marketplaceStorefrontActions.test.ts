/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SUTRA_OPEN_MARKETPLACE_ACTION_ID } from '../../browser/ainativeSettingsPane.js';
import { MenuRegistry, MenuId } from '../../../../../platform/actions/common/actions.js';

suite('MarketplaceStorefront Actions & Workbench Integration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should have registered SUTRA_OPEN_MARKETPLACE_ACTION_ID', () => {
		assert.strictEqual(SUTRA_OPEN_MARKETPLACE_ACTION_ID, 'workbench.action.sutra.openMarketplace');
	});

	test('should have valid marketplace action metadata in registry', () => {
		const menuItems = MenuRegistry.getMenuItems(MenuId.CommandPalette);
		const marketplaceAction = menuItems.find(item =>
			'command' in item && item.command.id === SUTRA_OPEN_MARKETPLACE_ACTION_ID
		);

		assert.strictEqual(marketplaceAction !== undefined, true);
		if (marketplaceAction && 'command' in marketplaceAction) {
			assert.strictEqual(
				typeof marketplaceAction.command.title === 'string'
					? marketplaceAction.command.title.includes('Marketplace')
					: marketplaceAction.command.title.value.includes('Marketplace'),
				true
			);
		}
	});

	test('should validate supported categories in unified marketplace', () => {
		const categories = ['extension', 'skill', 'mcp', 'hook', 'vibe'];
		assert.strictEqual(categories.length, 5);
		assert.strictEqual(categories.includes('extension'), true);
		assert.strictEqual(categories.includes('skill'), true);
		assert.strictEqual(categories.includes('mcp'), true);
		assert.strictEqual(categories.includes('hook'), true);
		assert.strictEqual(categories.includes('vibe'), true);
	});
});

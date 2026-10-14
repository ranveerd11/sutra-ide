/*--------------------------------------------------------------------------------------
 *  Copyright 2025 AINative Studio All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { StateType } from '../../../../../platform/update/common/update.js';
import { AINativeMainUpdateService } from '../../electron-main/ainativeUpdateMainService.js';

suite('AINativeMainUpdateService', () => {
	const disposables = new DisposableStore();
	let originalFetch: typeof global.fetch;

	setup(() => {
		originalFetch = global.fetch;
	});

	teardown(() => {
		global.fetch = originalFetch;
		disposables.clear();
	});

	test('should check releases against ranveerd11/sutra-ide repository', async () => {
		let capturedUrl = '';

		global.fetch = (async (url: string | URL | Request) => {
			capturedUrl = url.toString();
			return new Response(JSON.stringify({ tag_name: 'v2.0.0' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as any;

		const mockProduct = { version: 'v1.0.0' } as any;
		const mockEnv = { isBuilt: true } as any;
		const mockUpdate = {
			state: { type: StateType.Disabled },
			checkForUpdates: () => {}
		} as any;

		const updateService = disposables.add(new AINativeMainUpdateService(mockProduct, mockEnv, mockUpdate));
		const result = await updateService.check(true);

		assert.ok(capturedUrl.includes('ranveerd11/sutra-ide/releases/latest'), 'Must target sovereign sutra-ide repository');
		assert.ok(result !== null);
		if (result && 'action' in result) {
			assert.strictEqual(result.action, 'reinstall');
		}
		assert.ok(result && result.message ? result.message.includes('Sutra IDE is available') : false, 'Must use Sutra IDE branding');
	});

	test('should report up-to-date when versions match', async () => {
		global.fetch = (async () => {
			return new Response(JSON.stringify({ tag_name: 'v1.0.0' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}) as any;

		const mockProduct = { version: 'v1.0.0' } as any;
		const mockEnv = { isBuilt: true } as any;
		const mockUpdate = {
			state: { type: StateType.Disabled },
			checkForUpdates: () => {}
		} as any;

		const updateService = disposables.add(new AINativeMainUpdateService(mockProduct, mockEnv, mockUpdate));
		const result = await updateService.check(true);

		assert.ok(result !== null);
		assert.strictEqual(result?.message, 'Sutra IDE is up-to-date!');
	});

	test('should prompt restart when update state is Ready', async () => {
		const mockProduct = { version: 'v1.0.0' } as any;
		const mockEnv = { isBuilt: true } as any;
		const mockUpdate = {
			state: { type: StateType.Ready },
			checkForUpdates: () => {}
		} as any;

		const updateService = disposables.add(new AINativeMainUpdateService(mockProduct, mockEnv, mockUpdate));
		const result = await updateService.check(true);

		assert.ok(result !== null);
		if (result && 'action' in result) {
			assert.strictEqual(result.action, 'restart');
		}
		assert.strictEqual(result?.message, 'Restart Sutra IDE to update!');
	});
});

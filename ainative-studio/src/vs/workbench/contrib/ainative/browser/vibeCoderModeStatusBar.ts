/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize2, localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IAINativeSettingsService } from '../common/ainativeSettingsService.js';
import { IUnifiedCatalogService } from '../common/marketplace/unifiedCatalogTypes.js';
import { IShadowTestRunnerService } from '../common/shadowTestRunnerService.js';
import {
	SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID,
	SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID,
	SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID,
	SUTRA_OPEN_MARKETPLACE_ACTION_ID
} from './actionIDs.js';

export interface VibePersonaQuickPickItem extends IQuickPickItem {
	readonly id: string;
}

export interface VibeSkillQuickPickItem extends IQuickPickItem {
	readonly id: string;
	readonly installed: boolean;
	readonly enabled: boolean;
}

/**
 * Ambient HUD and Status Bar Contribution for Vibe Coder Mode
 * Displays quick-switching indicators for active Persona, loaded Skills,
 * and Speculative Sandbox execution status when chrome is minimized.
 */
export class VibeCoderModeStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.ainative.vibeCoderModeStatusBar';

	private readonly _statusBarDisposables = this._register(new DisposableStore());
	private _personaAccessor: IStatusbarEntryAccessor | null = null;
	private _skillsAccessor: IStatusbarEntryAccessor | null = null;
	private _sandboxAccessor: IStatusbarEntryAccessor | null = null;
	private _marketplaceAccessor: IStatusbarEntryAccessor | null = null;

	private _currentPersonaName = 'Rapid Prototyper';
	private _activeSkillsCount = 0;
	private _sandboxStatusText = 'Idle';

	constructor(
		@IStatusbarService private readonly _statusbarService: IStatusbarService,
		@IAINativeSettingsService private readonly _ainativeSettingsService: IAINativeSettingsService,
		@IUnifiedCatalogService private readonly _catalogService: IUnifiedCatalogService
	) {
		super();

		this._register(this._ainativeSettingsService.onDidChangeState(() => this._syncVibeHud()));
		this._register(this._catalogService.onDidCatalogChange(() => this._refreshCatalogState()));

		this._syncVibeHud();
	}

	private async _syncVibeHud(): Promise<void> {
		const isVibeMode = !!this._ainativeSettingsService.state.globalSettings.isVibeCoderMode;

		if (!isVibeMode) {
			this._tearDownStatusBar();
			return;
		}

		await this._refreshCatalogState();
		this._mountStatusBar();
	}

	private async _refreshCatalogState(): Promise<void> {
		try {
			const vibeResult = await this._catalogService.queryCatalog({ category: 'vibe' });
			const activePersona = vibeResult.items.find(i => i.enabled);
			if (activePersona) {
				this._currentPersonaName = activePersona.displayName.replace(' Persona', '');
			}

			const skillsResult = await this._catalogService.queryCatalog({ category: 'skill' });
			this._activeSkillsCount = skillsResult.items.filter(s => s.installed && s.enabled).length;

			this._updateEntryTexts();
		} catch {
			// Fail open with cached values
		}
	}

	private _mountStatusBar(): void {
		if (this._personaAccessor) {
			this._updateEntryTexts();
			return;
		}

		this._personaAccessor = this._statusbarService.addEntry(
			{
				name: localize('sutraPersonaStatus', "Sutra Persona"),
				text: `$(sparkle) ${this._currentPersonaName}`,
				ariaLabel: localize('sutraPersonaAria', "Active Persona: {0}", this._currentPersonaName),
				tooltip: localize('sutraPersonaTooltip', "Active Persona: {0} (Click to switch)", this._currentPersonaName),
				command: SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID
			},
			'sutra.vibe.persona',
			StatusbarAlignment.LEFT,
			103
		);

		this._skillsAccessor = this._statusbarService.addEntry(
			{
				name: localize('sutraSkillsStatus', "Sutra Skills"),
				text: `$(zap) ${this._activeSkillsCount} Skills`,
				ariaLabel: localize('sutraSkillsAria', "{0} Active Skills", this._activeSkillsCount),
				tooltip: localize('sutraSkillsTooltip', "{0} Skills Active (Click to toggle)", this._activeSkillsCount),
				command: SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID
			},
			'sutra.vibe.skills',
			StatusbarAlignment.LEFT,
			102
		);

		this._sandboxAccessor = this._statusbarService.addEntry(
			{
				name: localize('sutraSandboxStatus', "Sutra Sandbox"),
				text: `$(beaker) Sandbox: ${this._sandboxStatusText}`,
				ariaLabel: localize('sutraSandboxAria', "Sandbox Status: {0}", this._sandboxStatusText),
				tooltip: localize('sutraSandboxTooltip', "Shadow Sandbox Verification (Click to run tests)"),
				command: SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID
			},
			'sutra.vibe.sandbox',
			StatusbarAlignment.LEFT,
			101
		);

		this._marketplaceAccessor = this._statusbarService.addEntry(
			{
				name: localize('sutraStorefrontStatus', "Sutra Storefront"),
				text: `$(extensions) Storefront`,
				ariaLabel: localize('sutraStorefrontAria', "Sutra Marketplace"),
				tooltip: localize('sutraStorefrontTooltip', "Browse Sutra Marketplace (Extensions, Skills, MCP)"),
				command: SUTRA_OPEN_MARKETPLACE_ACTION_ID
			},
			'sutra.vibe.marketplace',
			StatusbarAlignment.LEFT,
			100
		);

		this._statusBarDisposables.add({
			dispose: () => this._tearDownStatusBar()
		});
	}

	private _updateEntryTexts(): void {
		if (this._personaAccessor) {
			this._personaAccessor.update({
				name: localize('sutraPersonaStatus', "Sutra Persona"),
				text: `$(sparkle) ${this._currentPersonaName}`,
				ariaLabel: localize('sutraPersonaAria', "Active Persona: {0}", this._currentPersonaName),
				tooltip: localize('sutraPersonaTooltip', "Active Persona: {0} (Click to switch)", this._currentPersonaName),
				command: SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID
			});
		}

		if (this._skillsAccessor) {
			this._skillsAccessor.update({
				name: localize('sutraSkillsStatus', "Sutra Skills"),
				text: `$(zap) ${this._activeSkillsCount} Skills`,
				ariaLabel: localize('sutraSkillsAria', "{0} Active Skills", this._activeSkillsCount),
				tooltip: localize('sutraSkillsTooltip', "{0} Skills Active (Click to toggle)", this._activeSkillsCount),
				command: SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID
			});
		}

		if (this._sandboxAccessor) {
			this._sandboxAccessor.update({
				name: localize('sutraSandboxStatus', "Sutra Sandbox"),
				text: `$(beaker) Sandbox: ${this._sandboxStatusText}`,
				ariaLabel: localize('sutraSandboxAria', "Sandbox Status: {0}", this._sandboxStatusText),
				tooltip: localize('sutraSandboxTooltip', "Shadow Sandbox Verification (Click to inspect)"),
				command: SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID
			});
		}
	}

	public updateSandboxStatus(status: string): void {
		this._sandboxStatusText = status;
		this._updateEntryTexts();
	}

	private _tearDownStatusBar(): void {
		this._personaAccessor?.dispose();
		this._personaAccessor = null;

		this._skillsAccessor?.dispose();
		this._skillsAccessor = null;

		this._sandboxAccessor?.dispose();
		this._sandboxAccessor = null;

		this._marketplaceAccessor?.dispose();
		this._marketplaceAccessor = null;
	}
}

registerWorkbenchContribution2(
	VibeCoderModeStatusBarContribution.ID,
	VibeCoderModeStatusBarContribution,
	WorkbenchPhase.AfterRestored
);

// Action: Switch Active Vibe Persona
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SUTRA_VIBE_SWITCH_PERSONA_ACTION_ID,
			title: localize2('sutraVibeSwitchPersona', "Sutra: Switch Persona"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const catalogService = accessor.get(IUnifiedCatalogService);
		const notificationService = accessor.get(INotificationService);

		const result = await catalogService.queryCatalog({ category: 'vibe' });
		const picks: VibePersonaQuickPickItem[] = result.items.map(item => ({
			id: item.id,
			label: item.enabled ? `$(check) ${item.displayName}` : item.displayName,
			description: item.description,
			detail: `Rating: ★${item.rating} · ${item.publisher}`
		}));

		const selected = await quickInput.pick(picks, {
			placeHolder: localize('selectPersonaPlaceholder', "Select active Vibe persona...")
		});

		if (selected) {
			await catalogService.toggleItem(selected.id, true);
			notificationService.info(localize('personaSwitched', "Switched active persona to: {0}", selected.label.replace('$(check) ', '')));
		}
	}
});

// Action: Toggle Skills in Vibe Mode
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SUTRA_VIBE_TOGGLE_SKILLS_ACTION_ID,
			title: localize2('sutraVibeToggleSkills', "Sutra: Toggle Skills"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const catalogService = accessor.get(IUnifiedCatalogService);
		const notificationService = accessor.get(INotificationService);

		const result = await catalogService.queryCatalog({ category: 'skill' });
		const picks: VibeSkillQuickPickItem[] = result.items.map(item => ({
			id: item.id,
			label: item.enabled ? `$(check) ${item.displayName}` : `$(circle-outline) ${item.displayName}`,
			description: item.installed ? (item.enabled ? 'Enabled' : 'Disabled') : 'Not Installed',
			detail: item.description,
			installed: item.installed,
			enabled: item.enabled
		}));

		const selected = await quickInput.pick(picks, {
			placeHolder: localize('toggleSkillPlaceholder', "Select skill to install or toggle...")
		});

		if (selected) {
			if (!selected.installed) {
				await catalogService.installItem(selected.id);
				notificationService.info(localize('skillInstalled', "Installed skill: {0}", selected.label));
			} else {
				await catalogService.toggleItem(selected.id, !selected.enabled);
				notificationService.info(localize('skillToggled', "Toggled skill: {0}", selected.label));
			}
		}
	}
});

// Action: Inspect Speculative Sandbox Tests
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SUTRA_VIBE_SANDBOX_STATUS_ACTION_ID,
			title: localize2('sutraVibeSandboxStatus', "Sutra: Inspect Sandbox Tests"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInput = accessor.get(IQuickInputService);
		const shadowRunner = accessor.get(IShadowTestRunnerService);
		const notificationService = accessor.get(INotificationService);

		const action = await quickInput.pick([
			{
				id: 'run',
				label: '$(play) Run Tests in Speculative Sandbox',
				description: 'Executes detected workspace test runner inside isolated shadow worktree'
			},
			{
				id: 'status',
				label: '$(info) View Current Sandbox Status',
				description: 'Check active shadow workspaces and verification results'
			}
		], {
			placeHolder: localize('sandboxActionPlaceholder', "Shadow Sandbox Actions")
		});

		if (action?.id === 'run') {
			notificationService.info(localize('sandboxRunning', "Running tests inside speculative shadow workspace..."));
			const res = await shadowRunner.runShadowTests('vibe-manual-run');
			if (res.status === 'passed') {
				notificationService.info(localize('sandboxPassed', "✓ All {0} tests passed in sandbox ({1}ms)", res.numPassed, res.durationMs));
			} else {
				notificationService.warn(localize('sandboxFailed', "⚡ Tests failed in sandbox ({0} failed, {1} passed)", res.numFailed, res.numPassed));
			}
		} else if (action?.id === 'status') {
			notificationService.info(localize('sandboxStatusInfo', "Shadow Sandbox is ready for autonomous verification."));
		}
	}
});

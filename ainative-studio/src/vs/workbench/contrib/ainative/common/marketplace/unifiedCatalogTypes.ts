/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../../base/common/event.js';

export const IUnifiedCatalogService = createDecorator<IUnifiedCatalogService>('unifiedCatalogService');

export type CatalogCategory = 'extension' | 'skill' | 'mcp' | 'hook' | 'vibe';

export interface UnifiedCatalogItem {
	/** Namespaced ID, e.g. "ext:ms-python.python", "skill:git-workflows", "mcp:github" */
	id: string;
	/** Slug identifier */
	name: string;
	/** Human-readable title */
	displayName: string;
	/** Item description */
	description: string;
	/** Category discriminator */
	category: CatalogCategory;
	/** Version identifier */
	version: string;
	/** Author or publisher */
	publisher: string;
	/** Optional icon URL or symbol */
	iconUrl?: string;
	/** Average rating (1 to 5) */
	rating: number;
	/** Download or user count */
	downloads: number;
	/** Filter keywords and categories */
	tags: string[];
	/** True if installed locally */
	installed: boolean;
	/** True if active */
	enabled: boolean;
	/** Optional code repository */
	repository?: string;
	/** Optional documentation homepage */
	homepage?: string;
	/** Additional type-specific configuration */
	metadata?: Record<string, unknown>;
}

export interface UnifiedCatalogQuery {
	/** Free-text search query */
	query?: string;
	/** Category filter */
	category?: CatalogCategory | 'all';
	/** Filter by installation status */
	installedOnly?: boolean;
	/** Sorting parameter */
	sortBy?: 'relevance' | 'downloads' | 'rating' | 'name' | 'recentlyUpdated';
	/** Pagination limit */
	limit?: number;
	/** Pagination offset */
	offset?: number;
}

export interface UnifiedCatalogResult {
	items: UnifiedCatalogItem[];
	total: number;
	categoryCounts: Record<CatalogCategory, number>;
}

export interface CatalogCategoryInfo {
	id: CatalogCategory;
	displayName: string;
	description: string;
	icon: string;
}

export interface IUnifiedCatalogService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when an item is installed, uninstalled, or toggled
	 */
	readonly onDidCatalogChange: Event<void>;

	/**
	 * Search and filter across the unified catalog
	 */
	queryCatalog(query?: UnifiedCatalogQuery): Promise<UnifiedCatalogResult>;

	/**
	 * Retrieve detailed item metadata
	 */
	getItem(id: string): Promise<UnifiedCatalogItem | null>;

	/**
	 * Install a catalog item by its namespaced ID
	 */
	installItem(id: string): Promise<void>;

	/**
	 * Uninstall an installed catalog item
	 */
	uninstallItem(id: string): Promise<void>;

	/**
	 * Toggle the enabled state of an item
	 */
	toggleItem(id: string, enabled: boolean): Promise<void>;

	/**
	 * List all supported catalog categories with metadata
	 */
	getCategories(): CatalogCategoryInfo[];
}

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccessor } from '../util/services.js';
import {
	UnifiedCatalogItem,
	CatalogCategory,
	UnifiedCatalogResult,
	CatalogCategoryInfo
} from '../../../../common/marketplace/unifiedCatalogTypes.js';

export const UnifiedMarketplaceStorefront: React.FC = () => {
	const accessor = useAccessor();
	const catalogService = accessor.IUnifiedCatalogService;
	const notificationService = accessor.INotificationService;

	const [searchQuery, setSearchQuery] = useState('');
	const [selectedCategory, setSelectedCategory] = useState<CatalogCategory | 'all'>('all');
	const [sortBy, setSortBy] = useState<'relevance' | 'downloads' | 'rating' | 'name'>('relevance');
	const [installedOnly, setInstalledOnly] = useState(false);

	const [catalogResult, setCatalogResult] = useState<UnifiedCatalogResult>({
		items: [],
		total: 0,
		categoryCounts: { extension: 0, skill: 0, mcp: 0, hook: 0, vibe: 0 }
	});
	const [isLoading, setIsLoading] = useState(true);
	const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
	const [selectedItemDetail, setSelectedItemDetail] = useState<UnifiedCatalogItem | null>(null);

	const categories: CatalogCategoryInfo[] = useMemo(() => {
		return catalogService ? catalogService.getCategories() : [];
	}, [catalogService]);

	const refreshCatalog = useCallback(async () => {
		if (!catalogService) return;
		setIsLoading(true);
		try {
			const res = await catalogService.queryCatalog({
				query: searchQuery,
				category: selectedCategory,
				sortBy,
				installedOnly
			});
			setCatalogResult(res);
		} catch (err) {
			notificationService.error(`Failed to load marketplace catalog: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setIsLoading(false);
		}
	}, [catalogService, searchQuery, selectedCategory, sortBy, installedOnly, notificationService]);

	useEffect(() => {
		let isMounted = true;
		catalogService?.queryCatalog({
			query: searchQuery,
			category: selectedCategory,
			sortBy,
			installedOnly
		}).then(res => {
			if (isMounted) {
				setCatalogResult(res);
				setIsLoading(false);
			}
		}).catch(err => {
			if (isMounted) {
				notificationService.error(`Failed to load marketplace catalog: ${err instanceof Error ? err.message : String(err)}`);
				setIsLoading(false);
			}
		});
		return () => { isMounted = false; };
	}, [catalogService, searchQuery, selectedCategory, sortBy, installedOnly, notificationService]);

	const handleInstall = async (item: UnifiedCatalogItem) => {
		if (!catalogService) return;
		setActionLoadingId(item.id);
		try {
			await catalogService.installItem(item.id);
			notificationService.info(`Successfully installed ${item.displayName}`);
			await refreshCatalog();
		} catch (err) {
			notificationService.error(`Failed to install ${item.displayName}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleUninstall = async (item: UnifiedCatalogItem) => {
		if (!catalogService) return;
		setActionLoadingId(item.id);
		try {
			await catalogService.uninstallItem(item.id);
			notificationService.info(`Uninstalled ${item.displayName}`);
			await refreshCatalog();
		} catch (err) {
			notificationService.error(`Failed to uninstall ${item.displayName}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setActionLoadingId(null);
		}
	};

	const handleToggle = async (item: UnifiedCatalogItem, enabled: boolean) => {
		if (!catalogService) return;
		setActionLoadingId(item.id);
		try {
			await catalogService.toggleItem(item.id, enabled);
			await refreshCatalog();
		} catch (err) {
			notificationService.error(`Failed to update ${item.displayName}: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setActionLoadingId(null);
		}
	};

	const formatNumber = (num: number): string => {
		if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
		if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
		return String(num);
	};

	const getCategoryBadgeClass = (category: CatalogCategory): string => {
		switch (category) {
			case 'extension':
				return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
			case 'skill':
				return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
			case 'mcp':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
			case 'hook':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
			case 'vibe':
				return 'bg-pink-500/15 text-pink-400 border-pink-500/30';
		}
	};

	return (
		<div className="flex flex-col h-full w-full space-y-6 text-ainative-fg-1">
			{/* Marketplace Header */}
			<div className="border-b border-ainative-border-1 pb-4">
				<div className="flex items-center justify-between mb-2">
					<div>
						<h1 className="text-xl font-semibold text-ainative-fg-1 flex items-center gap-2">
							<span>Sutra Studio Marketplace</span>
							<span className="text-xs font-normal px-2 py-0.5 rounded-full bg-ainative-bg-2 border border-ainative-border-1 text-ainative-fg-3">
								Decentralized & Sovereign
							</span>
						</h1>
						<p className="text-xs text-ainative-fg-3 mt-1">
							Discover and install Extensions (Open VSX), Agent Skills, MCP Plugins, Lifecycle Hooks, and Vibe Personas.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<button
							onClick={() => refreshCatalog()}
							className="px-3 py-1.5 text-xs bg-ainative-bg-2 hover:bg-ainative-bg-3 border border-ainative-border-1 rounded text-ainative-fg-2 transition-colors flex items-center gap-1.5"
						>
							<span>⟳</span>
							<span>Refresh</span>
						</button>
					</div>
				</div>

				{/* Search & Sort Controls */}
				<div className="flex flex-wrap items-center gap-3 mt-4">
					<div className="flex-1 min-w-[260px] relative">
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search extensions, skills, MCP plugins, hooks, personas..."
							className="w-full bg-ainative-bg-2 border border-ainative-border-1 rounded px-3 py-1.5 text-xs text-ainative-fg-1 placeholder-ainative-fg-3 focus:outline-none focus:border-ainative-accent-1"
						/>
						{searchQuery && (
							<button
								onClick={() => setSearchQuery('')}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ainative-fg-3 hover:text-ainative-fg-1 text-xs"
							>
								✕
							</button>
						)}
					</div>

					<div className="flex items-center gap-2">
						<label htmlFor="marketplace-sort-select" className="text-xs text-ainative-fg-3">Sort:</label>
						<select
							id="marketplace-sort-select"
							value={sortBy}
							onChange={(e) => setSortBy(e.target.value as any)}
							className="bg-ainative-bg-2 border border-ainative-border-1 rounded px-2 py-1.5 text-xs text-ainative-fg-1 focus:outline-none focus:border-ainative-accent-1"
						>
							<option value="relevance">Most Relevant</option>
							<option value="downloads">Most Popular</option>
							<option value="rating">Highest Rated</option>
							<option value="name">Alphabetical</option>
						</select>
					</div>

					<label className="flex items-center gap-2 text-xs text-ainative-fg-2 cursor-pointer select-none">
						<input
							type="checkbox"
							checked={installedOnly}
							onChange={(e) => setInstalledOnly(e.target.checked)}
							className="rounded bg-ainative-bg-2 border-ainative-border-1 text-ainative-accent-1 focus:ring-0"
						/>
						<span>Installed only</span>
					</label>
				</div>

				{/* Category Pills */}
				<div className="flex flex-wrap items-center gap-2 mt-4 pt-2 border-t border-ainative-border-1/50">
					<button
						onClick={() => setSelectedCategory('all')}
						className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
							selectedCategory === 'all'
								? 'bg-ainative-fg-1 text-ainative-bg-1 border-ainative-fg-1'
								: 'bg-ainative-bg-2 text-ainative-fg-3 border-ainative-border-1 hover:text-ainative-fg-1'
						}`}
					>
						All Categories ({catalogResult.total})
					</button>

					{categories.map((cat) => {
						const count = catalogResult.categoryCounts[cat.id] || 0;
						const isSelected = selectedCategory === cat.id;
						return (
							<button
								key={cat.id}
								onClick={() => setSelectedCategory(cat.id)}
								className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5 ${
									isSelected
										? 'bg-ainative-fg-1 text-ainative-bg-1 border-ainative-fg-1'
										: 'bg-ainative-bg-2 text-ainative-fg-3 border-ainative-border-1 hover:text-ainative-fg-1'
								}`}
							>
								<span>{cat.displayName}</span>
								<span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-ainative-bg-1/20 text-ainative-bg-1' : 'bg-ainative-bg-3 text-ainative-fg-3'}`}>
									{count}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Item Grid */}
			{isLoading ? (
				<div className="flex items-center justify-center p-12 text-ainative-fg-3 text-sm">
					Loading marketplace catalog...
				</div>
			) : catalogResult.items.length === 0 ? (
				<div className="flex flex-col items-center justify-center p-12 text-center">
					<p className="text-sm font-medium text-ainative-fg-2">No catalog items found</p>
					<p className="text-xs text-ainative-fg-3 mt-1">Try adjusting your search query or category filters</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
					{catalogResult.items.map((item) => {
						const isActionLoading = actionLoadingId === item.id;
						return (
							<div
								key={item.id}
								className="bg-ainative-bg-2 border border-ainative-border-1 hover:border-ainative-border-2 rounded-lg p-4 flex flex-col justify-between transition-all hover:shadow-sm"
							>
								<div>
									{/* Top Badge & Publisher */}
									<div className="flex items-center justify-between mb-2">
										<span
											className={`text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded border ${getCategoryBadgeClass(
												item.category
											)}`}
										>
											{item.category}
										</span>
										<span className="text-[11px] text-ainative-fg-3 font-mono">
											v{item.version}
										</span>
									</div>

									{/* Title & Description */}
									<button
										type="button"
										onClick={() => setSelectedItemDetail(item)}
										className="text-sm font-semibold text-ainative-fg-1 hover:text-ainative-accent-1 text-left cursor-pointer transition-colors line-clamp-1 p-0 bg-transparent border-0"
									>
										{item.displayName}
									</button>
									<p className="text-[11px] text-ainative-fg-3 mb-2 font-mono">
										by {item.publisher}
									</p>
									<p className="text-xs text-ainative-fg-2 line-clamp-2 mb-3 leading-relaxed">
										{item.description}
									</p>

									{/* Tags */}
									<div className="flex flex-wrap gap-1 mb-3">
										{item.tags.slice(0, 3).map((tag, idx) => (
											<span
												key={idx}
												className="text-[10px] px-1.5 py-0.5 rounded bg-ainative-bg-3 text-ainative-fg-3 font-mono"
											>
												#{tag}
											</span>
										))}
									</div>
								</div>

								{/* Footer: Rating, Downloads & Action Button */}
								<div className="border-t border-ainative-border-1/60 pt-3 flex items-center justify-between text-[11px]">
									<div className="flex items-center gap-2 text-ainative-fg-3">
										<span className="flex items-center gap-1 text-amber-400">
											★ <span className="text-ainative-fg-2 font-medium">{item.rating}</span>
										</span>
										<span>•</span>
										<span>{formatNumber(item.downloads)} DL</span>
									</div>

									<div className="flex items-center gap-1.5">
										{item.installed ? (
											<>
												{item.category === 'hook' || item.category === 'vibe' || item.category === 'mcp' ? (
													<button
														disabled={isActionLoading}
														onClick={() => handleToggle(item, !item.enabled)}
														className={`px-2 py-1 text-xs rounded border transition-colors ${
															item.enabled
																? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
																: 'bg-ainative-bg-3 text-ainative-fg-3 border-ainative-border-1 hover:text-ainative-fg-1'
														}`}
													>
														{item.enabled ? 'Enabled' : 'Disabled'}
													</button>
												) : (
													<span className="text-[11px] text-emerald-400 font-medium px-2 py-0.5">
														✓ Installed
													</span>
												)}
												<button
													disabled={isActionLoading}
													onClick={() => handleUninstall(item)}
													className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 transition-colors"
													title="Uninstall"
												>
													✕
												</button>
											</>
										) : (
											<button
												disabled={isActionLoading}
												onClick={() => handleInstall(item)}
												className="px-3 py-1 bg-ainative-accent-1 text-white hover:bg-ainative-accent-2 text-xs font-medium rounded transition-colors disabled:opacity-50"
											>
												{isActionLoading ? 'Installing...' : 'Install'}
											</button>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Item Details Drawer/Modal */}
			{selectedItemDetail && (
				<div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
					<div className="bg-ainative-bg-1 border border-ainative-border-2 rounded-xl max-w-xl w-full p-6 shadow-2xl relative">
						<button
							onClick={() => setSelectedItemDetail(null)}
							className="absolute top-4 right-4 text-ainative-fg-3 hover:text-ainative-fg-1 text-sm"
						>
							✕
						</button>

						<div className="flex items-center gap-2 mb-2">
							<span
								className={`text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded border ${getCategoryBadgeClass(
									selectedItemDetail.category
								)}`}
							>
								{selectedItemDetail.category}
							</span>
							<span className="text-xs text-ainative-fg-3 font-mono">
								v{selectedItemDetail.version}
							</span>
						</div>

						<h2 className="text-lg font-bold text-ainative-fg-1 mb-1">
							{selectedItemDetail.displayName}
						</h2>
						<p className="text-xs text-ainative-fg-3 mb-4 font-mono">
							Published by {selectedItemDetail.publisher}
						</p>

						<p className="text-sm text-ainative-fg-2 mb-4 leading-relaxed">
							{selectedItemDetail.description}
						</p>

						<div className="bg-ainative-bg-2 border border-ainative-border-1 rounded p-3 mb-4 space-y-1.5 text-xs">
							<div className="flex justify-between text-ainative-fg-3">
								<span>Rating:</span>
								<span className="text-ainative-fg-1 font-medium">{selectedItemDetail.rating} / 5.0</span>
							</div>
							<div className="flex justify-between text-ainative-fg-3">
								<span>Downloads:</span>
								<span className="text-ainative-fg-1 font-medium">
									{formatNumber(selectedItemDetail.downloads)}
								</span>
							</div>
							{selectedItemDetail.repository && (
								<div className="flex justify-between text-ainative-fg-3">
									<span>Repository:</span>
									<a
										href={selectedItemDetail.repository}
										target="_blank"
										rel="noreferrer"
										className="text-ainative-accent-1 hover:underline truncate max-w-[280px]"
									>
										{selectedItemDetail.repository}
									</a>
								</div>
							)}
							{selectedItemDetail.homepage && (
								<div className="flex justify-between text-ainative-fg-3">
									<span>Homepage:</span>
									<a
										href={selectedItemDetail.homepage}
										target="_blank"
										rel="noreferrer"
										className="text-ainative-accent-1 hover:underline truncate max-w-[280px]"
									>
										{selectedItemDetail.homepage}
									</a>
								</div>
							)}
						</div>

						<div className="flex justify-end gap-2">
							<button
								onClick={() => setSelectedItemDetail(null)}
								className="px-4 py-1.5 text-xs bg-ainative-bg-2 hover:bg-ainative-bg-3 border border-ainative-border-1 rounded text-ainative-fg-2 transition-colors"
							>
								Close
							</button>
							{!selectedItemDetail.installed ? (
								<button
									onClick={() => {
										handleInstall(selectedItemDetail);
										setSelectedItemDetail(null);
									}}
									className="px-4 py-1.5 text-xs bg-ainative-accent-1 hover:bg-ainative-accent-2 text-white font-medium rounded transition-colors"
								>
									Install {selectedItemDetail.displayName}
								</button>
							) : (
								<button
									onClick={() => {
										handleUninstall(selectedItemDetail);
										setSelectedItemDetail(null);
									}}
									className="px-4 py-1.5 text-xs bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium rounded transition-colors"
								>
									Uninstall
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

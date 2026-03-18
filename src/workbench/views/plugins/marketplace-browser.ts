/**
 * In-IDE marketplace browser — search, browse, install, and update plugins.
 *
 * Renders a plugin browser panel in the extensions sidebar.
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import {
  VStack, HStack, Text, Button, Spacer, TextField, ScrollView,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetWidth,
  scrollViewSetChild,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

// Marketplace plugin listing (inline type — Perry can't import from marketplace package)
interface MarketplaceListing {
  name: string;
  displayName: string;
  version: string;
  author: string;
  description: string;
  downloads: number;
  rating: number;
  tier: number;
  verified: number;
}

// Module-level state
let browseContainer: unknown = null;
let resultsContainer: unknown = null;
let searchField: unknown = null;
let currentColors: ResolvedUIColors | null = null;
let listings: MarketplaceListing[] = [];
let installCallbacks: Map<string, () => void> = new Map();

/** Set install callback (wired by plugins.ts to actual install logic). */
export function setInstallCallback(name: string, handler: () => void): void {
  installCallbacks.set(name, handler);
}

/**
 * Render the marketplace browser in the extensions panel.
 * Called when __plugins__ is enabled.
 */
export function renderMarketplaceBrowser(container: unknown, colors: ResolvedUIColors): void {
  currentColors = colors;
  browseContainer = container;

  // Section header
  const header = Text('MARKETPLACE');
  textSetFontSize(header, 11);
  textSetFontWeight(header, 11, 0.7);
  setFg(header, colors.sideBarForeground);
  widgetAddChild(container, header);

  // Search bar
  const searchRow = HStack(4, []);
  const searchInput = TextField('Search plugins...', (text: string) => { onSearchInput(text); });
  widgetSetWidth(searchInput, 180);
  widgetAddChild(searchRow, searchInput);
  searchField = searchInput;

  const searchBtn = Button('Search', () => { onSearchSubmit(); });
  buttonSetBordered(searchBtn, 1);
  textSetFontSize(searchBtn, 11);
  setBtnFg(searchBtn, colors.sideBarForeground);
  widgetAddChild(searchRow, searchBtn);

  widgetAddChild(container, searchRow);

  // Category quick filters
  const categories = HStack(4, []);
  const cats = ['All', 'Languages', 'Formatters', 'Themes', 'AI'];
  for (let i = 0; i < cats.length; i++) {
    const catName = cats[i];
    const catBtn = Button(catName, () => { onCategoryClick(catName); });
    buttonSetBordered(catBtn, 0);
    textSetFontSize(catBtn, 10);
    setBtnFg(catBtn, colors.sideBarForeground);
    widgetAddChild(categories, catBtn);
  }
  widgetAddChild(container, categories);

  // Results list
  const scroll = ScrollView();
  const results = VStack(6, []);
  scrollViewSetChild(scroll, results);
  resultsContainer = results;
  widgetAddChild(container, scroll);

  // Show placeholder
  renderPlaceholder(results, colors);
}

/** Render placeholder when no search has been performed. */
function renderPlaceholder(container: unknown, colors: ResolvedUIColors): void {
  const msg = Text('Search for plugins or browse by category');
  textSetFontSize(msg, 12);
  setFg(msg, colors.sideBarForeground);
  widgetAddChild(container, msg);
}

/** Render search results. */
function renderResults(container: unknown, results: MarketplaceListing[], colors: ResolvedUIColors): void {
  widgetClearChildren(container);

  if (results.length === 0) {
    const noResults = Text('No plugins found');
    textSetFontSize(noResults, 12);
    setFg(noResults, colors.sideBarForeground);
    widgetAddChild(container, noResults);
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const plugin = results[i];
    renderListingCard(container, plugin, colors);
  }
}

/** Render a single plugin listing card. */
function renderListingCard(container: unknown, plugin: MarketplaceListing, colors: ResolvedUIColors): void {
  const card = VStack(2, []);

  // Name + version row
  const nameRow = HStack(4, []);
  const nameLabel = Text(plugin.displayName);
  textSetFontSize(nameLabel, 13);
  textSetFontWeight(nameLabel, 13, 0.6);
  setFg(nameLabel, colors.sideBarForeground);
  widgetAddChild(nameRow, nameLabel);

  let versionText = 'v';
  versionText += plugin.version;
  const versionLabel = Text(versionText);
  textSetFontSize(versionLabel, 11);
  setFg(versionLabel, '#888888');
  widgetAddChild(nameRow, versionLabel);

  if (plugin.verified > 0) {
    const badge = Text('[verified]');
    textSetFontSize(badge, 10);
    setFg(badge, '#4EC9B0');
    widgetAddChild(nameRow, badge);
  }

  widgetAddChild(nameRow, Spacer());

  const pluginName = plugin.name;
  const installBtn = Button('Install', () => { onInstallClick(pluginName); });
  buttonSetBordered(installBtn, 1);
  textSetFontSize(installBtn, 11);
  setBtnFg(installBtn, colors.sideBarForeground);
  widgetAddChild(nameRow, installBtn);

  widgetAddChild(card, nameRow);

  // Description
  const desc = Text(plugin.description);
  textSetFontSize(desc, 11);
  setFg(desc, '#AAAAAA');
  widgetAddChild(card, desc);

  // Author + downloads row
  const metaRow = HStack(8, []);
  const author = Text(plugin.author);
  textSetFontSize(author, 10);
  setFg(author, '#888888');
  widgetAddChild(metaRow, author);

  let dlText = String(plugin.downloads);
  dlText += ' downloads';
  const downloads = Text(dlText);
  textSetFontSize(downloads, 10);
  setFg(downloads, '#888888');
  widgetAddChild(metaRow, downloads);

  widgetAddChild(card, metaRow);
  widgetAddChild(container, card);
}

// Module-level search state
let currentQuery: string = '';

function onSearchInput(text: string): void {
  currentQuery = text;
}

function onSearchSubmit(): void {
  // In a full implementation, this would call MarketplaceClient.search()
  // For now, show empty results
  if (resultsContainer !== null && currentColors !== null) {
    renderResults(resultsContainer, listings, currentColors);
  }
}

function onCategoryClick(category: string): void {
  // In a full implementation, this would filter by category
  if (resultsContainer !== null && currentColors !== null) {
    renderResults(resultsContainer, listings, currentColors);
  }
}

function onInstallClick(pluginName: string): void {
  const handler = installCallbacks.get(pluginName);
  if (handler !== undefined) {
    handler();
  }
}

/**
 * Update the results list from external data.
 * Called by the plugin system when marketplace data is fetched.
 */
export function updateMarketplaceResults(newListings: MarketplaceListing[]): void {
  listings = newListings;
  if (resultsContainer !== null && currentColors !== null) {
    renderResults(resultsContainer, listings, currentColors);
  }
}

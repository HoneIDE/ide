/**
 * In-IDE marketplace browser — search, browse, install, and update plugins.
 *
 * Renders a plugin browser panel in the extensions sidebar.
 * Fetches real data from marketplace.hone.codes via execSync+curl.
 * Falls back to built-in extension list when marketplace is unreachable.
 *
 * Perry-safe: module-level state, for-loops, no closures on `this`.
 */

import {
  VStack, HStack, Text, Button, Spacer, TextField, ScrollView,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered, buttonSetTitle,
  widgetAddChild, widgetClearChildren, widgetSetWidth, widgetSetHeight,
  widgetSetBackgroundColor,
  scrollViewSetChild,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';
import { execSync } from 'child_process';

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
let filteredListings: MarketplaceListing[] = [];
let installCallbacks: Map<string, () => void> = new Map();
let marketplaceOnline: number = 0;  // 0 = unknown, 1 = online, 2 = offline
let currentCategory: string = 'All';
let currentQuery: string = '';
let statusLabel: unknown = null;

// Marketplace API base URL
let apiBase = 'https://marketplace.hone.codes/api/v1';

// ---------------------------------------------------------------------------
// Built-in extensions fallback (shown when marketplace is unreachable)
// ---------------------------------------------------------------------------

function getBuiltinListings(): MarketplaceListing[] {
  const builtins: MarketplaceListing[] = [];

  builtins.push({
    name: 'hone.typescript',
    displayName: 'TypeScript & JavaScript',
    version: '1.0.0',
    author: 'hone',
    description: 'TypeScript and JavaScript language support including IntelliSense, refactoring, and snippets',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.python',
    displayName: 'Python',
    version: '1.0.0',
    author: 'hone',
    description: 'Python language support with Pyright-powered IntelliSense, linting, and debugging',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.rust',
    displayName: 'Rust',
    version: '1.0.0',
    author: 'hone',
    description: 'Rust language support powered by rust-analyzer',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.go',
    displayName: 'Go',
    version: '1.0.0',
    author: 'hone',
    description: 'Go language support with gopls',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.cpp',
    displayName: 'C/C++',
    version: '1.0.0',
    author: 'hone',
    description: 'C and C++ language support with clangd',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.html-css',
    displayName: 'HTML & CSS',
    version: '1.0.0',
    author: 'hone',
    description: 'HTML, CSS, and SCSS language support',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.json',
    displayName: 'JSON',
    version: '1.0.0',
    author: 'hone',
    description: 'JSON language support with schema validation',
    downloads: 0,
    rating: 0,
    tier: 1,
    verified: 1,
  });

  builtins.push({
    name: 'hone.markdown',
    displayName: 'Markdown',
    version: '1.0.0',
    author: 'hone',
    description: 'Markdown language support with preview',
    downloads: 0,
    rating: 0,
    tier: 1,
    verified: 1,
  });

  builtins.push({
    name: 'hone.git',
    displayName: 'Git',
    version: '1.0.0',
    author: 'hone',
    description: 'Git source control integration with blame, graph, and status bar',
    downloads: 0,
    rating: 0,
    tier: 3,
    verified: 1,
  });

  builtins.push({
    name: 'hone.docker',
    displayName: 'Docker',
    version: '1.0.0',
    author: 'hone',
    description: 'Dockerfile and Docker Compose language support',
    downloads: 0,
    rating: 0,
    tier: 2,
    verified: 1,
  });

  builtins.push({
    name: 'hone.toml-yaml',
    displayName: 'TOML & YAML',
    version: '1.0.0',
    author: 'hone',
    description: 'TOML and YAML language support with schema validation',
    downloads: 0,
    rating: 0,
    tier: 1,
    verified: 1,
  });

  return builtins;
}

// ---------------------------------------------------------------------------
// Marketplace HTTP client (Perry-safe: execSync + curl)
// ---------------------------------------------------------------------------

/**
 * Fetch JSON from the marketplace API.
 * Returns the raw JSON string, or empty string on failure.
 * Uses execSync + curl (Perry has no fetch/XMLHttpRequest).
 */
function marketplaceFetch(urlPath: string): string {
  let fullUrl = apiBase;
  fullUrl += urlPath;
  let cmd = 'curl -s --connect-timeout 3 --max-time 5 "';
  cmd += fullUrl;
  cmd += '"';
  try {
    const result = execSync(cmd, { encoding: 'utf-8' });
    if (result !== undefined && result !== null) {
      return String(result);
    }
  } catch (e: any) {
    // curl failed — marketplace unreachable
  }
  return '';
}

/**
 * Parse the /api/v1/plugins response into MarketplaceListing[].
 * Response format: {"results":[{name, displayName, description, version, author, downloads, rating, tier, ...}], "total":N, ...}
 */
function parsePluginResults(jsonStr: string): MarketplaceListing[] {
  const result: MarketplaceListing[] = [];
  if (jsonStr.length === 0) return result;

  try {
    const data = JSON.parse(jsonStr);
    if (data === undefined || data === null) return result;

    const results = data.results;
    if (results === undefined || results === null) return result;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r === undefined || r === null) continue;

      const nameVal = r.name;
      if (nameVal === undefined || nameVal === null) continue;

      let displayNameVal = r.displayName;
      if (displayNameVal === undefined || displayNameVal === null) {
        displayNameVal = nameVal;
      }

      let descVal = r.description;
      if (descVal === undefined || descVal === null) {
        descVal = '';
      }

      let versionVal = r.version;
      if (versionVal === undefined || versionVal === null) {
        versionVal = '0.0.0';
      }

      let authorVal = r.author;
      if (authorVal === undefined || authorVal === null) {
        authorVal = '';
      }

      let dlVal = r.downloads;
      if (dlVal === undefined || dlVal === null) {
        dlVal = 0;
      }

      let ratingVal = r.rating;
      if (ratingVal === undefined || ratingVal === null) {
        ratingVal = 0;
      }

      let tierVal = r.tier;
      if (tierVal === undefined || tierVal === null) {
        tierVal = 0;
      }

      let verifiedVal = 0;
      if (r.verified === true) {
        verifiedVal = 1;
      }

      const listing: MarketplaceListing = {
        name: String(nameVal),
        displayName: String(displayNameVal),
        version: String(versionVal),
        author: String(authorVal),
        description: String(descVal),
        downloads: Number(dlVal),
        rating: Number(ratingVal),
        tier: Number(tierVal),
        verified: verifiedVal,
      };
      result.push(listing);
    }
  } catch (e: any) {
    // JSON parse failed
  }

  return result;
}

/**
 * Search the marketplace for plugins.
 * Supports query text and/or category filter.
 */
function fetchMarketplacePlugins(query: string, category: string): MarketplaceListing[] {
  let urlPath = '/plugins?pageSize=30';

  if (query.length > 0) {
    urlPath += '&query=';
    urlPath += query;
  }

  if (category.length > 0 && category !== 'All') {
    urlPath += '&category=';
    urlPath += category;
  }

  const jsonStr = marketplaceFetch(urlPath);
  if (jsonStr.length === 0) {
    marketplaceOnline = 2;
    return [];
  }

  // Check for error response
  if (jsonStr.indexOf('"error"') >= 0) {
    marketplaceOnline = 2;
    return [];
  }

  marketplaceOnline = 1;
  return parsePluginResults(jsonStr);
}

// ---------------------------------------------------------------------------
// Search and filter logic
// ---------------------------------------------------------------------------

/**
 * Perform a search: try marketplace first, fall back to builtins.
 * Updates module-level state and re-renders.
 */
function doSearch(): void {
  if (resultsContainer === null || currentColors === null) return;

  // Update status
  setStatusText('Searching...');

  // Try marketplace
  const results = fetchMarketplacePlugins(currentQuery, currentCategory);

  if (marketplaceOnline === 1) {
    // Marketplace responded
    listings = results;
    filteredListings = results;
    if (results.length > 0) {
      let statusMsg = String(results.length);
      statusMsg += ' plugins found';
      setStatusText(statusMsg);
    } else {
      setStatusText('No plugins found');
    }
  } else {
    // Marketplace unreachable — use builtins
    listings = getBuiltinListings();
    filteredListings = filterBuiltins(listings, currentQuery, currentCategory);
    setStatusText('Offline — showing built-in extensions');
  }

  renderResults(resultsContainer, filteredListings, currentColors);
}

/**
 * Filter built-in listings by query and category.
 * Used when marketplace is offline.
 */
function filterBuiltins(all: MarketplaceListing[], query: string, category: string): MarketplaceListing[] {
  const result: MarketplaceListing[] = [];

  for (let i = 0; i < all.length; i++) {
    const plugin = all[i];
    let matches = 1;

    // Filter by query text (case-insensitive check via indexOf on lowercase)
    if (query.length > 0) {
      const qLower = query.toLowerCase();
      const nameLower = plugin.displayName.toLowerCase();
      const descLower = plugin.description.toLowerCase();
      if (nameLower.indexOf(qLower) < 0 && descLower.indexOf(qLower) < 0) {
        matches = 0;
      }
    }

    // Filter by category
    if (matches === 1 && category.length > 0 && category !== 'All') {
      if (category === 'Languages') {
        // Language extensions include most of the builtins
        if (plugin.name === 'hone.git' || plugin.name === 'hone.docker') {
          matches = 0;
        }
      } else if (category === 'Themes') {
        // No builtin themes as separate extensions
        matches = 0;
      } else if (category === 'AI') {
        // No builtin AI extensions
        matches = 0;
      } else if (category === 'Formatters') {
        // No standalone formatter builtins
        matches = 0;
      }
    }

    if (matches === 1) {
      result.push(plugin);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Status text helper
// ---------------------------------------------------------------------------

function setStatusText(msg: string): void {
  if (statusLabel !== null && currentColors !== null) {
    buttonSetTitle(statusLabel, msg);
  }
}

// ---------------------------------------------------------------------------
// Exports and callbacks
// ---------------------------------------------------------------------------

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

  // Status line (shows "Searching...", "X plugins found", "Offline", etc.)
  const statusText = Button('', () => {});
  buttonSetBordered(statusText, 0);
  textSetFontSize(statusText, 10);
  setBtnFg(statusText, '#888888');
  statusLabel = statusText;
  widgetAddChild(container, statusText);

  // Results list
  const scroll = ScrollView();
  const results = VStack(6, []);
  scrollViewSetChild(scroll, results);
  resultsContainer = results;
  widgetAddChild(container, scroll);

  // Load initial data: try featured plugins, fall back to builtins
  loadInitialData();
}

/**
 * Load initial data on panel open.
 * Tries to fetch featured plugins from marketplace; falls back to builtins.
 */
function loadInitialData(): void {
  if (resultsContainer === null || currentColors === null) return;

  setStatusText('Loading...');

  // Try to fetch featured/popular plugins
  const jsonStr = marketplaceFetch('/plugins?pageSize=20&sort=downloads');

  if (jsonStr.length > 0 && jsonStr.indexOf('"error"') < 0) {
    marketplaceOnline = 1;
    const results = parsePluginResults(jsonStr);
    if (results.length > 0) {
      listings = results;
      filteredListings = results;
      let statusMsg = 'Popular plugins (';
      statusMsg += String(results.length);
      statusMsg += ' shown)';
      setStatusText(statusMsg);
      renderResults(resultsContainer, results, currentColors);
      return;
    }
  }

  // Marketplace unreachable or empty — show builtins
  marketplaceOnline = 2;
  listings = getBuiltinListings();
  filteredListings = listings;
  setStatusText('Offline — showing built-in extensions');
  renderResults(resultsContainer, listings, currentColors);
}

/** Render search results. */
function renderResults(container: unknown, results: MarketplaceListing[], colors: ResolvedUIColors): void {
  widgetClearChildren(container);

  if (results.length === 0) {
    const noResults = Text('No plugins found');
    textSetFontSize(noResults, 12);
    setFg(noResults, colors.sideBarForeground);
    widgetAddChild(container, noResults);

    // Show suggestion when marketplace is offline
    if (marketplaceOnline === 2) {
      const hint = Text('Marketplace is unreachable. Check your connection.');
      textSetFontSize(hint, 11);
      setFg(hint, '#888888');
      widgetAddChild(container, hint);
    }
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const plugin = results[i];
    renderListingCard(container, plugin, colors);

    // Add a thin separator between cards
    if (i < results.length - 1) {
      const sep = Text('');
      widgetSetHeight(sep, 1);
      widgetSetBackgroundColor(sep, 0.3, 0.3, 0.3, 0.5);
      widgetAddChild(container, sep);
    }
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
  // SHIP-V1-GAPS.md #12: install pipeline is a mock in v1.0 (returns a
  // stub string from `hone-extension/marketplace/src/client.ts:134`). Label
  // and behavior reflect that until the real download → sha256 verify →
  // extract → register flow lands in v1.1. Built-in extensions still show
  // "Built-in" via the existing onInstallClick fallback.
  const installBtn = Button('Preview (v1.1)', () => { onInstallClick(pluginName); });
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

  // Author + downloads + rating row
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

  // Show rating if available
  if (plugin.rating > 0) {
    let ratingText = String(plugin.rating);
    ratingText += ' stars';
    const ratingLabel = Text(ratingText);
    textSetFontSize(ratingLabel, 10);
    setFg(ratingLabel, '#D4A04C');
    widgetAddChild(metaRow, ratingLabel);
  }

  // Show tier badge
  if (plugin.tier > 0) {
    let tierText = '';
    if (plugin.tier === 1) {
      tierText = 'UI Only';
    } else if (plugin.tier === 2) {
      tierText = 'Standard';
    } else if (plugin.tier === 3) {
      tierText = 'High Privilege';
    }
    if (tierText.length > 0) {
      let tierBadge = '[';
      tierBadge += tierText;
      tierBadge += ']';
      const tierLabel = Text(tierBadge);
      textSetFontSize(tierLabel, 9);
      if (plugin.tier === 3) {
        setFg(tierLabel, '#FF8844');
      } else {
        setFg(tierLabel, '#666666');
      }
      widgetAddChild(metaRow, tierLabel);
    }
  }

  widgetAddChild(card, metaRow);
  widgetAddChild(container, card);
}

// ---------------------------------------------------------------------------
// Event handlers (module-level functions — Perry-safe)
// ---------------------------------------------------------------------------

function onSearchInput(text: string): void {
  currentQuery = text;
}

function onSearchSubmit(): void {
  doSearch();
}

function onCategoryClick(category: string): void {
  currentCategory = category;
  doSearch();
}

function onInstallClick(pluginName: string): void {
  // Check if we have a registered install callback (built-in extensions
  // register their own enable handlers — those still work).
  const handler = installCallbacks.get(pluginName);
  if (handler !== undefined) {
    handler();
    return;
  }

  // SHIP-V1-GAPS.md #12: the marketplace install pipeline is a stub for
  // v1.0. Rather than silently download a placeholder, surface the gap:
  // the user can browse plugins (read-only) and the install path will
  // land in v1.1.
  if (marketplaceOnline === 1) {
    showInstallStatus(pluginName, 'Marketplace install lands in v1.1. Browse and review until then.');
  } else {
    showInstallStatus(pluginName, 'Built-in extension (already included)');
  }
}

/**
 * Download and install a plugin from the marketplace.
 * For now, downloads the plugin metadata and shows status.
 * Full install flow requires the plugin host to load the binary.
 */
function installFromMarketplace(pluginName: string): void {
  showInstallStatus(pluginName, 'Downloading...');

  // Fetch plugin detail to get download URL
  let detailPath = '/plugins/';
  detailPath += pluginName;
  const jsonStr = marketplaceFetch(detailPath);

  if (jsonStr.length === 0) {
    showInstallStatus(pluginName, 'Download failed — marketplace unreachable');
    return;
  }

  try {
    const detail = JSON.parse(jsonStr);
    if (detail === undefined || detail === null) {
      showInstallStatus(pluginName, 'Download failed — invalid response');
      return;
    }

    const errField = detail.error;
    if (errField !== undefined && errField !== null) {
      let errMsg = 'Not found: ';
      errMsg += String(errField);
      showInstallStatus(pluginName, errMsg);
      return;
    }

    // Plugin info retrieved successfully
    // Full install: download the platform-specific binary and load via plugin host
    // For now, show success with version info
    let version = detail.version;
    if (version === undefined || version === null) {
      version = '0.0.0';
    }

    let successMsg = 'Install coming soon (';
    successMsg += String(pluginName);
    successMsg += ' v';
    successMsg += String(version);
    successMsg += ')';
    showInstallStatus(pluginName, successMsg);
  } catch (e: any) {
    showInstallStatus(pluginName, 'Download failed — parse error');
  }
}

/**
 * Show install status in the status line.
 */
function showInstallStatus(pluginName: string, message: string): void {
  setStatusText(message);
}

/**
 * Update the results list from external data.
 * Called by the plugin system when marketplace data is fetched.
 */
export function updateMarketplaceResults(newListings: MarketplaceListing[]): void {
  listings = newListings;
  filteredListings = newListings;
  if (resultsContainer !== null && currentColors !== null) {
    renderResults(resultsContainer, listings, currentColors);
  }
}

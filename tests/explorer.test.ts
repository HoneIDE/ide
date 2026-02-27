/**
 * File explorer tests — tree construction, expand/collapse, selection,
 * file operations validation, and multi-device layout assertions.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { FileTree, type FileEntryInput } from '../src/workbench/views/explorer/file-tree';
import {
  resolveFileIcon,
  getFileContextActions,
  getTreeItemHeight,
  getIndentWidth,
} from '../src/workbench/views/explorer/file-tree-item';
import { validateFileName } from '../src/workbench/views/explorer/file-operations';
import { QuickOpen } from '../src/workbench/views/quick-open/quick-open';
import { MIN_TOUCH_TARGET } from '../src/platform';
import {
  ALL_DEVICES,
  PHONE_DEVICES,
  TABLET_DEVICES,
  DESKTOP_DEVICES,
} from './devices';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ROOT_ENTRIES: FileEntryInput[] = [
  { name: 'src', path: '/project/src', relativePath: 'src', type: 'directory' },
  { name: 'tests', path: '/project/tests', relativePath: 'tests', type: 'directory' },
  { name: 'package.json', path: '/project/package.json', relativePath: 'package.json', type: 'file' },
  { name: 'tsconfig.json', path: '/project/tsconfig.json', relativePath: 'tsconfig.json', type: 'file' },
  { name: 'README.md', path: '/project/README.md', relativePath: 'README.md', type: 'file' },
];

const SRC_CHILDREN: FileEntryInput[] = [
  { name: 'components', path: '/project/src/components', relativePath: 'src/components', type: 'directory' },
  { name: 'app.ts', path: '/project/src/app.ts', relativePath: 'src/app.ts', type: 'file' },
  { name: 'index.ts', path: '/project/src/index.ts', relativePath: 'src/index.ts', type: 'file' },
];

// ===========================================================================
// FileTree tests
// ===========================================================================

describe('FileTree', () => {
  let tree: FileTree;

  beforeEach(() => {
    tree = new FileTree();
    tree.setRootEntries(ROOT_ENTRIES);
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  test('sets root entries correctly', () => {
    const state = tree.getState();
    expect(state.roots.length).toBe(5);
    expect(state.flatList.length).toBe(5);
  });

  test('roots are in input order', () => {
    const names = tree.getState().roots.map(r => r.name);
    expect(names).toEqual(['src', 'tests', 'package.json', 'tsconfig.json', 'README.md']);
  });

  test('directories have correct type and depth', () => {
    const src = tree.getItem('/project/src');
    expect(src?.type).toBe('directory');
    expect(src?.depth).toBe(0);
    expect(src?.expanded).toBe(false);
  });

  test('files have correct icons', () => {
    const pkg = tree.getItem('/project/package.json');
    expect(pkg?.icon).toBe('file-npm');

    const tsconfig = tree.getItem('/project/tsconfig.json');
    expect(tsconfig?.icon).toBe('file-typescript-config');

    const readme = tree.getItem('/project/README.md');
    expect(readme?.icon).toBe('file-readme');
  });

  // -----------------------------------------------------------------------
  // Expand / Collapse
  // -----------------------------------------------------------------------

  test('toggleExpand expands a directory', () => {
    const expanded = tree.toggleExpand('/project/src');
    expect(expanded).toBe(true);
    expect(tree.isExpanded('/project/src')).toBe(true);
  });

  test('toggleExpand on expanded directory collapses it', () => {
    tree.toggleExpand('/project/src');
    const expanded = tree.toggleExpand('/project/src');
    expect(expanded).toBe(false);
    expect(tree.isExpanded('/project/src')).toBe(false);
  });

  test('expanding a directory adds children to flat list after loading', () => {
    tree.toggleExpand('/project/src');
    tree.setDirectoryChildren('/project/src', SRC_CHILDREN);

    const flatNames = tree.getState().flatList.map(i => i.name);
    // src should be expanded, children visible after it
    const srcIdx = flatNames.indexOf('src');
    expect(flatNames[srcIdx + 1]).toBe('components');
    expect(flatNames[srcIdx + 2]).toBe('app.ts');
    expect(flatNames[srcIdx + 3]).toBe('index.ts');
  });

  test('children have depth = parent depth + 1', () => {
    tree.toggleExpand('/project/src');
    tree.setDirectoryChildren('/project/src', SRC_CHILDREN);

    const app = tree.getItem('/project/src/app.ts');
    expect(app?.depth).toBe(1);
  });

  test('collapseAll hides all children', () => {
    tree.toggleExpand('/project/src');
    tree.setDirectoryChildren('/project/src', SRC_CHILDREN);
    expect(tree.visibleCount).toBe(8); // 5 root + 3 children

    tree.collapseAll();
    expect(tree.visibleCount).toBe(5);
  });

  test('toggleExpand on file returns false', () => {
    const result = tree.toggleExpand('/project/package.json');
    expect(result).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  test('select highlights single item', () => {
    tree.select('/project/package.json');
    expect(tree.selectedCount).toBe(1);
    expect(tree.getItem('/project/package.json')?.selected).toBe(true);
  });

  test('select clears previous selection', () => {
    tree.select('/project/package.json');
    tree.select('/project/README.md');
    expect(tree.selectedCount).toBe(1);
    expect(tree.getItem('/project/package.json')?.selected).toBe(false);
    expect(tree.getItem('/project/README.md')?.selected).toBe(true);
  });

  test('toggleSelect supports multi-selection', () => {
    tree.toggleSelect('/project/package.json');
    tree.toggleSelect('/project/README.md');
    expect(tree.selectedCount).toBe(2);
  });

  test('clearSelection deselects all', () => {
    tree.select('/project/package.json');
    tree.clearSelection();
    expect(tree.selectedCount).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  test('addEntry inserts into parent directory sorted', () => {
    tree.toggleExpand('/project/src');
    tree.setDirectoryChildren('/project/src', SRC_CHILDREN);

    tree.addEntry('/project/src', {
      name: 'utils.ts',
      path: '/project/src/utils.ts',
      relativePath: 'src/utils.ts',
      type: 'file',
    });

    const src = tree.getItem('/project/src');
    const names = src!.children.map(c => c.name);
    // 'components' (dir first), then 'app.ts', 'index.ts', 'utils.ts' (alphabetical)
    expect(names).toEqual(['components', 'app.ts', 'index.ts', 'utils.ts']);
  });

  test('removeEntry removes from tree', () => {
    const before = tree.visibleCount;
    tree.removeEntry('/project/README.md');
    expect(tree.visibleCount).toBe(before - 1);
    expect(tree.getItem('/project/README.md')).toBeUndefined();
  });

  test('renameEntry updates name and path', () => {
    tree.renameEntry('/project/README.md', 'CHANGELOG.md', '/project/CHANGELOG.md', 'CHANGELOG.md');
    const item = tree.getItem('/project/CHANGELOG.md');
    expect(item?.name).toBe('CHANGELOG.md');
    expect(item?.icon).toBe('file-markdown');
  });

  // -----------------------------------------------------------------------
  // Keyboard navigation
  // -----------------------------------------------------------------------

  test('moveFocusDown moves through flat list', () => {
    tree.moveFocusDown();
    expect(tree.getState().focusedId).toBe('/project/src');

    tree.moveFocusDown();
    expect(tree.getState().focusedId).toBe('/project/tests');
  });

  test('moveFocusUp moves backwards', () => {
    tree.moveFocusDown(); // src
    tree.moveFocusDown(); // tests
    tree.moveFocusUp();   // back to src
    expect(tree.getState().focusedId).toBe('/project/src');
  });

  // -----------------------------------------------------------------------
  // Virtual scrolling
  // -----------------------------------------------------------------------

  test('getVisibleRange returns slice of flat list', () => {
    const range = tree.getVisibleRange(1, 3);
    expect(range.length).toBe(3);
    expect(range[0].name).toBe('tests');
  });

  test('getVisibleItemCount uses correct row height per mode', () => {
    const desktopCount = tree.getVisibleItemCount(500, 'full');
    const phoneCount = tree.getVisibleItemCount(500, 'compact');

    // Desktop rows are smaller, so more items fit
    expect(desktopCount).toBeGreaterThan(phoneCount);
  });
});

// ===========================================================================
// File icon resolution tests
// ===========================================================================

describe('File icon resolution', () => {
  test('directories get folder icon', () => {
    expect(resolveFileIcon('src', 'directory')).toBe('folder');
  });

  test('TypeScript files get typescript icon', () => {
    expect(resolveFileIcon('app.ts', 'file')).toBe('file-typescript');
    expect(resolveFileIcon('Component.tsx', 'file')).toBe('file-typescript');
  });

  test('Python files get python icon', () => {
    expect(resolveFileIcon('main.py', 'file')).toBe('file-python');
  });

  test('special filenames get specific icons', () => {
    expect(resolveFileIcon('package.json', 'file')).toBe('file-npm');
    expect(resolveFileIcon('Dockerfile', 'file')).toBe('file-docker');
    expect(resolveFileIcon('.gitignore', 'file')).toBe('file-git');
  });

  test('unknown extensions get generic file icon', () => {
    expect(resolveFileIcon('data.xyz', 'file')).toBe('file');
  });
});

// ===========================================================================
// Context menu tests
// ===========================================================================

describe('Context menu', () => {
  const fileItem = {
    id: '/test/file.ts', name: 'file.ts', path: '/test/file.ts',
    relativePath: 'file.ts', type: 'file' as const, depth: 0,
    expanded: false, selected: false, renaming: false,
    icon: 'file-typescript', children: [],
  };

  const dirItem = {
    ...fileItem, id: '/test/src', name: 'src', path: '/test/src',
    type: 'directory' as const, icon: 'folder',
  };

  test('file context menu includes Open, Rename, Delete', () => {
    const actions = getFileContextActions(fileItem, 'full');
    const ids = actions.map(a => a.id);
    expect(ids).toContain('open');
    expect(ids).toContain('rename');
    expect(ids).toContain('delete');
  });

  test('directory context menu includes New File, New Folder', () => {
    const actions = getFileContextActions(dirItem, 'full');
    const ids = actions.map(a => a.id);
    expect(ids).toContain('newFile');
    expect(ids).toContain('newFolder');
  });

  test('compact layout removes "Open to the Side"', () => {
    const fullActions = getFileContextActions(fileItem, 'full');
    const compactActions = getFileContextActions(fileItem, 'compact');

    expect(fullActions.some(a => a.id === 'openToSide')).toBe(true);
    expect(compactActions.some(a => a.id === 'openToSide')).toBe(false);
  });

  test('delete action is marked destructive', () => {
    const actions = getFileContextActions(fileItem, 'full');
    const del = actions.find(a => a.id === 'delete');
    expect(del?.destructive).toBe(true);
  });
});

// ===========================================================================
// File name validation tests
// ===========================================================================

describe('validateFileName', () => {
  test('valid names pass', () => {
    expect(validateFileName('app.ts')).toBeNull();
    expect(validateFileName('my-component.tsx')).toBeNull();
    expect(validateFileName('test_file')).toBeNull();
    expect(validateFileName('123')).toBeNull();
  });

  test('empty name fails', () => {
    expect(validateFileName('')).not.toBeNull();
    expect(validateFileName('   ')).not.toBeNull();
  });

  test('path separators fail', () => {
    expect(validateFileName('src/app.ts')).not.toBeNull();
    expect(validateFileName('src\\app.ts')).not.toBeNull();
  });

  test('special characters fail', () => {
    expect(validateFileName('file<name')).not.toBeNull();
    expect(validateFileName('file:name')).not.toBeNull();
    expect(validateFileName('file?name')).not.toBeNull();
    expect(validateFileName('file*name')).not.toBeNull();
  });

  test('trailing space or dot fails', () => {
    expect(validateFileName('file ')).not.toBeNull();
    expect(validateFileName('file.')).not.toBeNull();
  });

  test('just a dot fails', () => {
    expect(validateFileName('.')).not.toBeNull();
    expect(validateFileName('..')).not.toBeNull();
  });
});

// ===========================================================================
// QuickOpen tests
// ===========================================================================

describe('QuickOpen', () => {
  let qo: QuickOpen;

  beforeEach(() => {
    qo = new QuickOpen();
    qo.setSearchProvider((query) => {
      const files = [
        'src/app.ts', 'src/platform.ts', 'src/commands.ts',
        'src/workbench/layout/grid.ts', 'src/workbench/theme/theme-loader.ts',
        'package.json', 'tests/layout.test.ts',
      ];
      if (!query) {
        return files.map(f => ({
          path: f, filename: f.split('/').pop()!, score: 0, matchIndices: [],
        }));
      }
      const lq = query.toLowerCase();
      return files
        .filter(f => f.toLowerCase().includes(lq))
        .map(f => ({
          path: f,
          filename: f.split('/').pop()!,
          score: 10,
          matchIndices: [],
        }));
    });
  });

  test('starts hidden', () => {
    expect(qo.isVisible).toBe(false);
  });

  test('show makes it visible with results', () => {
    qo.show();
    expect(qo.isVisible).toBe(true);
    expect(qo.getState().items.length).toBeGreaterThan(0);
  });

  test('hide clears state', () => {
    qo.show();
    qo.hide();
    expect(qo.isVisible).toBe(false);
    expect(qo.getState().items.length).toBe(0);
  });

  test('setQuery filters results', () => {
    qo.show();
    qo.setQuery('grid');
    const items = qo.getState().items;
    expect(items.length).toBe(1);
    expect(items[0].path).toBe('src/workbench/layout/grid.ts');
  });

  test('focusDown moves focus through results', () => {
    qo.show();
    expect(qo.getState().focusedIndex).toBe(0);

    qo.focusDown();
    expect(qo.getState().focusedIndex).toBe(1);
  });

  test('focusUp moves focus backwards', () => {
    qo.show();
    qo.focusDown();
    qo.focusDown();
    qo.focusUp();
    expect(qo.getState().focusedIndex).toBe(1);
  });

  test('accept calls select handler and hides', () => {
    let selected: string | null = null;
    qo.setSelectHandler((path) => { selected = path; });

    qo.show();
    qo.accept();

    expect(selected).not.toBeNull();
    expect(qo.isVisible).toBe(false);
  });

  test('acceptIndex selects by index (for touch)', () => {
    let selected: string | null = null;
    qo.setSelectHandler((path) => { selected = path; });

    qo.show();
    qo.acceptIndex(2);

    expect(selected).toBe('src/commands.ts');
  });

  test('focused item has focused=true', () => {
    qo.show();
    const items = qo.getState().items;
    expect(items[0].focused).toBe(true);
    expect(items[1].focused).toBe(false);
  });
});

// ===========================================================================
// Multi-device layout assertions
// ===========================================================================

describe('Explorer multi-device layout', () => {
  describe('tree item height', () => {
    for (const device of PHONE_DEVICES) {
      test(`${device.name}: touch-friendly row height (>= ${MIN_TOUCH_TARGET}pt)`, () => {
        const height = getTreeItemHeight(device.context.layoutMode);
        expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      });
    }

    for (const device of DESKTOP_DEVICES) {
      test(`${device.name}: compact row height for mouse`, () => {
        const height = getTreeItemHeight(device.context.layoutMode);
        expect(height).toBeLessThan(MIN_TOUCH_TARGET);
      });
    }
  });

  describe('indent width', () => {
    for (const device of PHONE_DEVICES) {
      test(`${device.name}: wider indent for touch`, () => {
        const indent = getIndentWidth(device.context.layoutMode);
        expect(indent).toBeGreaterThanOrEqual(24);
      });
    }

    for (const device of DESKTOP_DEVICES) {
      test(`${device.name}: narrow indent for mouse`, () => {
        const indent = getIndentWidth(device.context.layoutMode);
        expect(indent).toBeLessThan(24);
      });
    }
  });

  describe('quick open layout', () => {
    const qo = new QuickOpen();

    for (const device of PHONE_DEVICES) {
      test(`${device.name}: full-screen quick open`, () => {
        const layout = qo.getLayout(device.context.layoutMode);
        expect(layout.position).toBe('full');
        expect(layout.maxHeight).toBe('full');
        expect(layout.itemHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      });
    }

    for (const device of DESKTOP_DEVICES) {
      test(`${device.name}: centered overlay quick open`, () => {
        const layout = qo.getLayout(device.context.layoutMode);
        expect(layout.position).toBe('top-center');
        expect(layout.maxWidth).toBeLessThanOrEqual(600);
      });
    }
  });

  describe('context menu adapts to layout', () => {
    const fileItem = {
      id: '/test/file.ts', name: 'file.ts', path: '/test/file.ts',
      relativePath: 'file.ts', type: 'file' as const, depth: 0,
      expanded: false, selected: false, renaming: false,
      icon: 'file-typescript', children: [],
    };

    for (const device of PHONE_DEVICES) {
      test(`${device.name}: no "Open to Side" action`, () => {
        const actions = getFileContextActions(fileItem, device.context.layoutMode);
        expect(actions.some(a => a.id === 'openToSide')).toBe(false);
      });
    }

    for (const device of [...TABLET_DEVICES, ...DESKTOP_DEVICES]) {
      test(`${device.name}: has "Open to Side" action`, () => {
        const actions = getFileContextActions(fileItem, device.context.layoutMode);
        expect(actions.some(a => a.id === 'openToSide')).toBe(true);
      });
    }
  });
});

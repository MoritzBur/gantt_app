const fs = require('fs');
const path = require('path');
const { DEFAULT_CALENDAR_STORE, normalizeCalendarStore } = require('./calendar/shared');
const runtimePaths = require('./runtime-paths');

const DATA_DIR = runtimePaths.resolveDataDir();

const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  state: path.join(DATA_DIR, 'state.json'),
  calendarConfig: path.join(DATA_DIR, 'calendar-config.json'),
  tokens: path.join(DATA_DIR, 'tokens.json'),
  notes: path.join(DATA_DIR, 'notes'),
};

const DEFAULT_TASKS = { version: 2, items: [] };
const MAX_DEPTH = 5;

// ─── Tree helpers ────────────────────────────────────────────────────────────

/** Migrate v1 (phases > tasks) to v2 (recursive items > children) */
function migrateV1toV2(data) {
  if (data && data.version === 2) return data;
  const phases = Array.isArray(data?.phases) ? data.phases : [];
  return {
    version: 2,
    items: phases.map(phase => {
      const { tasks, ...rest } = phase;
      return {
        ...rest,
        type: 'group',
        prefix: phase.prefix !== undefined ? phase.prefix : 'WP',
        children: (tasks || []).map(task => ({
          ...task,
          type: 'task',
          children: [],
        })),
      };
    }),
  };
}

/** Find a node by id anywhere in the tree. Returns { node, parent, index, siblings } or null */
function findNode(items, id, parent = null) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { node: items[i], parent, index: i, siblings: items };
    if (items[i].children && items[i].children.length > 0) {
      const found = findNode(items[i].children, id, items[i]);
      if (found) return found;
    }
  }
  return null;
}

/** Get depth of a node in the tree (0-based) */
function getNodeDepth(items, id, depth = 0) {
  for (const item of items) {
    if (item.id === id) return depth;
    if (item.children) {
      const found = getNodeDepth(item.children, id, depth + 1);
      if (found !== -1) return found;
    }
  }
  return -1;
}

/** Compute start/end bounds from all descendant tasks */
function calcGroupBounds(node) {
  if (node.type === 'task') {
    return node.start ? { start: node.start, end: node.end || node.start } : null;
  }
  const children = node.children || [];
  let minStart = null;
  let maxEnd = null;
  for (const child of children) {
    const bounds = calcGroupBounds(child);
    if (!bounds) continue;
    if (!minStart || bounds.start < minStart) minStart = bounds.start;
    if (!maxEnd || bounds.end > maxEnd) maxEnd = bounds.end;
  }
  return minStart ? { start: minStart, end: maxEnd } : null;
}

/** Recompute bounds for all ancestor groups of nodeId */
function recomputeAncestorBounds(data, nodeId) {
  const result = findNode(data.items, nodeId);
  if (!result) return;
  let current = result.parent;
  while (current && current.type === 'group') {
    const bounds = calcGroupBounds(current);
    if (bounds) {
      current.start = bounds.start;
      current.end = bounds.end;
    }
    const parentResult = findNode(data.items, current.id);
    current = parentResult ? parentResult.parent : null;
  }
}
const DEFAULT_STATE = {
  zoom: 'Month',
  density: 'Regular',
  theme: 'dark',
  collapsed: {},
  calendarCollapsed: {},
  calendarOrder: [],
  activeCalEvents: [],
  calendarEventIdsVersion: 2,
  listWidth: 260,
  notePanel: {
    open: false,
    width: 420,
    tabs: [],
    activeTabIndex: 0,
  },
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureNotesDir() {
  fs.mkdirSync(FILES.notes, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Failed to read JSON file ${file}:`, err);
    return fallback;
  }
}

function writeJsonAtomic(file, data, options = {}) {
  ensureDataDir();
  const json = JSON.stringify(data, null, 2);
  const tmpFile = path.join(path.dirname(file), `${path.basename(file)}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpFile, json, { encoding: 'utf8', mode: options.mode });
  fs.renameSync(tmpFile, file);
}

function writeTextAtomic(file, content, options = {}) {
  ensureDataDir();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpFile = path.join(path.dirname(file), `${path.basename(file)}.${Date.now()}.tmp`);
  fs.writeFileSync(tmpFile, String(content), { encoding: 'utf8', mode: options.mode });
  fs.renameSync(tmpFile, file);
}

function sanitizePathSegment(value) {
  return String(value || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80) || 'untitled';
}

function getNodeDirName(node) {
  return sanitizePathSegment(node.id || node.name || 'item');
}

function getDefaultNoteFile(node) {
  if (node.type === 'group') return '_phase.md';
  return `${sanitizePathSegment(node.id || node.name || 'note')}.md`;
}

function ensureNoteFilesInTree(data) {
  if (!data || !Array.isArray(data.items)) return false;

  let changed = false;

  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (!node.noteFile) {
        node.noteFile = getDefaultNoteFile(node);
        changed = true;
      }
      if (node.children?.length) visit(node.children);
    }
  };

  visit(data.items);
  return changed;
}

function findNodePath(items, id, parents = []) {
  for (const item of items || []) {
    const nextPath = [...parents, item];
    if (item.id === id) return nextPath;
    if (item.children?.length) {
      const found = findNodePath(item.children, id, nextPath);
      if (found) return found;
    }
  }
  return null;
}

function getAncestorGroupsForNodePath(nodePath) {
  if (!nodePath?.length) return [];
  const node = nodePath[nodePath.length - 1];
  const groups = nodePath.filter((entry) => entry.type === 'group');
  return node.type === 'group' ? groups.slice(0, -1) : groups;
}

function getStoragePathSegments(itemPath) {
  const groups = getAncestorGroupsForNodePath(itemPath);
  const node = itemPath?.[itemPath.length - 1];
  if (node?.type === 'group') {
    return [...groups.map(getNodeDirName), getNodeDirName(node)];
  }
  return groups.map(getNodeDirName);
}

function getGroupDirForNodePath(itemPath) {
  return path.join(FILES.notes, ...getStoragePathSegments(itemPath));
}

function getNoteBinding(data, itemId, options = {}) {
  const itemPath = findNodePath(data?.items || [], itemId);
  if (!itemPath) return null;

  const node = itemPath[itemPath.length - 1];
  const shouldAssignDefault = options.assignDefault !== false;
  let changed = false;

  if (!node.noteFile && shouldAssignDefault) {
    node.noteFile = getDefaultNoteFile(node);
    changed = true;
  }

  const groupDir = getGroupDirForNodePath(itemPath);
  const noteFile = node.noteFile || null;
  const mainPath = noteFile ? path.join(groupDir, noteFile) : null;
  const relatedDir = node.type === 'group'
    ? path.join(groupDir, '_related')
    : path.join(groupDir, sanitizePathSegment(node.id || 'item'));

  return {
    itemPath,
    node,
    changed,
    groupDir,
    noteFile,
    mainPath,
    relatedDir,
    groupPath: getStoragePathSegments(itemPath),
  };
}

function collectNoteEntries(data) {
  const notes = [];

  function walk(nodes) {
    for (const node of nodes || []) {
      const binding = getNoteBinding({ items: data.items }, node.id, { assignDefault: false });
      if (binding?.noteFile && binding.mainPath && fs.existsSync(binding.mainPath)) {
        notes.push({
          itemId: node.id,
          type: 'main',
          filename: binding.noteFile,
          basename: binding.noteFile.replace(/\.md$/i, ''),
          path: path.relative(FILES.notes, binding.mainPath),
          groupPath: binding.groupPath,
        });
      }

      if (binding && fs.existsSync(binding.relatedDir)) {
        const filenames = fs.readdirSync(binding.relatedDir)
          .filter((name) => name.toLowerCase().endsWith('.md'))
          .sort((a, b) => a.localeCompare(b));

        for (const filename of filenames) {
          notes.push({
            itemId: node.id,
            type: 'related',
            filename,
            basename: filename.replace(/\.md$/i, ''),
            path: path.relative(FILES.notes, path.join(binding.relatedDir, filename)),
            groupPath: binding.groupPath,
          });
        }
      }

      if (node.children?.length) walk(node.children);
    }
  }

  walk(data?.items || []);
  return notes;
}

function scoreLinkCandidate(sourceGroupPath, candidate) {
  let sharedDepth = 0;
  while (
    sharedDepth < sourceGroupPath.length &&
    sharedDepth < candidate.groupPath.length &&
    sourceGroupPath[sharedDepth] === candidate.groupPath[sharedDepth]
  ) {
    sharedDepth += 1;
  }

  const distance = (sourceGroupPath.length - sharedDepth) + (candidate.groupPath.length - sharedDepth);
  return (sharedDepth * 100) - distance;
}

function resolveLinkTarget(data, fromItemId, linkText) {
  const normalized = String(linkText || '').trim().replace(/\.md$/i, '').toLowerCase();
  if (!normalized) return null;

  const sourceBinding = getNoteBinding(data, fromItemId, { assignDefault: false });
  const sourceGroupPath = sourceBinding?.groupPath || [];

  const candidates = collectNoteEntries(data).filter((entry) => entry.basename.toLowerCase() === normalized);
  if (candidates.length === 0) return null;

  const [best] = candidates
    .map((entry) => ({ entry, score: scoreLinkCandidate(sourceGroupPath, entry) }))
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));

  return best?.entry || null;
}

function mergeNotePanelState(raw) {
  const fallback = { ...DEFAULT_STATE.notePanel };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;

  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs
      .filter((tab) => tab && typeof tab === 'object')
      .map((tab) => ({
        itemId: typeof tab.itemId === 'string' ? tab.itemId : '',
        filename: typeof tab.filename === 'string' ? tab.filename : '',
        type: tab.type === 'related' ? 'related' : 'main',
        pinned: tab.pinned !== false,
      }))
      .filter((tab) => tab.itemId && tab.filename)
    : [];

  const activeTabIndex = Number.isInteger(raw.activeTabIndex)
    ? Math.max(0, Math.min(raw.activeTabIndex, Math.max(tabs.length - 1, 0)))
    : fallback.activeTabIndex;

  return {
    open: !!raw.open,
    width: Number.isFinite(raw.width) ? raw.width : fallback.width,
    tabs,
    activeTabIndex,
  };
}

function mergeUiState(raw) {
  const next = { ...DEFAULT_STATE };
  if (!raw || typeof raw !== 'object') return next;
  if (typeof raw.zoom === 'string') next.zoom = raw.zoom;
  if (typeof raw.density === 'string') next.density = raw.density;
  if (raw.theme === 'light' || raw.theme === 'dark') next.theme = raw.theme;
  if (raw.collapsed && typeof raw.collapsed === 'object' && !Array.isArray(raw.collapsed)) {
    next.collapsed = raw.collapsed;
  }
  if (raw.calendarCollapsed && typeof raw.calendarCollapsed === 'object' && !Array.isArray(raw.calendarCollapsed)) {
    next.calendarCollapsed = raw.calendarCollapsed;
  }
  if (Array.isArray(raw.calendarOrder)) next.calendarOrder = raw.calendarOrder.filter(id => typeof id === 'string' && id.trim());
  if (Array.isArray(raw.activeCalEvents)) next.activeCalEvents = raw.activeCalEvents;
  if (raw.calendarEventIdsVersion === 2) next.calendarEventIdsVersion = 2;
  if (Number.isFinite(raw.listWidth)) next.listWidth = raw.listWidth;
  next.notePanel = mergeNotePanelState(raw.notePanel);
  return next;
}

function migrateInlineNotesToFiles(data, originalSnapshot = null) {
  if (!data || !Array.isArray(data.items)) return data;

  let changed = false;
  let wroteFiles = false;

  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (typeof node.notes === 'string') {
        const content = node.notes.trim();
        if (content) {
          const binding = getNoteBinding(data, node.id);
          if (binding?.changed) changed = true;
          if (binding?.mainPath && !fs.existsSync(binding.mainPath)) {
            ensureNotesDir();
            writeTextAtomic(binding.mainPath, `${content}\n`);
            wroteFiles = true;
          }
        }

        delete node.notes;
        changed = true;
      }

      if (node.children?.length) visit(node.children);
    }
  };

  visit(data.items);

  if (changed) {
    const backupPath = FILES.tasks.replace('.json', '.inline-notes.backup.json');
    if (originalSnapshot && !fs.existsSync(backupPath)) {
      try {
        fs.writeFileSync(backupPath, JSON.stringify(originalSnapshot, null, 2), 'utf8');
      } catch (_) {}
    }
    writeJsonAtomic(FILES.tasks, data);
  } else if (wroteFiles) {
    writeJsonAtomic(FILES.tasks, data);
  }

  return data;
}

function relocateLegacyNoteFiles(data) {
  if (!data || !Array.isArray(data.items)) return data;

  let changed = false;

  function walk(nodes) {
    for (const node of nodes || []) {
      const binding = getNoteBinding(data, node.id, { assignDefault: false });
      if (binding?.noteFile) {
        const legacyMainPath = path.join(FILES.notes, binding.noteFile);
        if (legacyMainPath !== binding.mainPath && fs.existsSync(legacyMainPath) && !fs.existsSync(binding.mainPath)) {
          fs.mkdirSync(path.dirname(binding.mainPath), { recursive: true });
          fs.renameSync(legacyMainPath, binding.mainPath);
          changed = true;
        }

        const legacyRelatedDir = path.join(FILES.notes, sanitizePathSegment(node.id || 'item'));
        if (
          node.type !== 'group' &&
          legacyRelatedDir !== binding.relatedDir &&
          fs.existsSync(legacyRelatedDir) &&
          !fs.existsSync(binding.relatedDir)
        ) {
          fs.mkdirSync(path.dirname(binding.relatedDir), { recursive: true });
          fs.renameSync(legacyRelatedDir, binding.relatedDir);
          changed = true;
        }
      }

      if (node.children?.length) walk(node.children);
    }
  }

  walk(data.items);
  return changed;
}

module.exports = {
  DATA_DIR,
  FILES,
  MAX_DEPTH,
  ensureDataDir,
  ensureNotesDir,
  findNode,
  findNodePath,
  getNodeDepth,
  calcGroupBounds,
  recomputeAncestorBounds,
  migrateV1toV2,
  getDefaultNoteFile,
  getNoteBinding,
  collectNoteEntries,
  resolveLinkTarget,
  writeTextAtomic,
  readTasks() {
    const raw = readJson(FILES.tasks, DEFAULT_TASKS);
    const originalSnapshot = JSON.parse(JSON.stringify(raw));
    if (raw && raw.version !== 2) {
      // Backup v1 before migration
      const backupPath = FILES.tasks.replace('.json', '.v1.backup.json');
      if (!fs.existsSync(backupPath)) {
        try { fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2), 'utf8'); } catch (_) {}
      }
      const migrated = migrateV1toV2(raw);
      const normalized = migrateInlineNotesToFiles(migrated, originalSnapshot);
      const notesChanged = ensureNoteFilesInTree(normalized);
      if (relocateLegacyNoteFiles(normalized) || notesChanged) {
        writeJsonAtomic(FILES.tasks, normalized);
      }
      return normalized;
    }
    const migrated = migrateInlineNotesToFiles(raw, originalSnapshot);
    const notesChanged = ensureNoteFilesInTree(migrated);
    if (relocateLegacyNoteFiles(migrated) || notesChanged) {
      writeJsonAtomic(FILES.tasks, migrated);
    }
    return migrated;
  },
  writeTasks(data) {
    ensureNoteFilesInTree(data);
    writeJsonAtomic(FILES.tasks, data);
  },
  readUiState() {
    return mergeUiState(readJson(FILES.state, DEFAULT_STATE));
  },
  writeUiState(data) {
    writeJsonAtomic(FILES.state, mergeUiState(data));
  },
  readCalendarConfig() {
    return normalizeCalendarStore(readJson(FILES.calendarConfig, DEFAULT_CALENDAR_STORE));
  },
  writeCalendarConfig(data) {
    writeJsonAtomic(FILES.calendarConfig, normalizeCalendarStore(data));
  },
  readTokens() {
    return readJson(FILES.tokens, null);
  },
  writeTokens(tokens) {
    writeJsonAtomic(FILES.tokens, tokens, { mode: 0o600 });
  },
  deleteTokens() {
    try {
      if (fs.existsSync(FILES.tokens)) fs.unlinkSync(FILES.tokens);
    } catch (err) {
      console.error('Failed to delete tokens:', err);
    }
  },
};

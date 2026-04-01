const fs = require('fs');
const path = require('path');
const { DEFAULT_CALENDAR_STORE, normalizeCalendarStore } = require('./calendar/shared');

const DEFAULT_DATA_DIR = path.join(__dirname, '../data');
const DATA_DIR = path.resolve(process.env.GANTT_DATA_DIR || DEFAULT_DATA_DIR);

const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  state: path.join(DATA_DIR, 'state.json'),
  calendarConfig: path.join(DATA_DIR, 'calendar-config.json'),
  tokens: path.join(DATA_DIR, 'tokens.json'),
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
  collapsed: {},
  calendarCollapsed: {},
  calendarOrder: [],
  activeCalEvents: [],
  calendarEventIdsVersion: 2,
  listWidth: 260,
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

function mergeUiState(raw) {
  const next = { ...DEFAULT_STATE };
  if (!raw || typeof raw !== 'object') return next;
  if (typeof raw.zoom === 'string') next.zoom = raw.zoom;
  if (typeof raw.density === 'string') next.density = raw.density;
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
  return next;
}

module.exports = {
  DATA_DIR,
  FILES,
  MAX_DEPTH,
  ensureDataDir,
  findNode,
  getNodeDepth,
  calcGroupBounds,
  recomputeAncestorBounds,
  migrateV1toV2,
  readTasks() {
    const raw = readJson(FILES.tasks, DEFAULT_TASKS);
    if (raw && raw.version !== 2) {
      // Backup v1 before migration
      const backupPath = FILES.tasks.replace('.json', '.v1.backup.json');
      if (!fs.existsSync(backupPath)) {
        try { fs.writeFileSync(backupPath, JSON.stringify(raw, null, 2), 'utf8'); } catch (_) {}
      }
      const migrated = migrateV1toV2(raw);
      writeJsonAtomic(FILES.tasks, migrated);
      return migrated;
    }
    return raw;
  },
  writeTasks(data) {
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

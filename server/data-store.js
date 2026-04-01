const fs = require('fs');
const path = require('path');
const runtimePaths = require('./runtime-paths');

const DATA_DIR = runtimePaths.resolveDataDir();

const FILES = {
  tasks: path.join(DATA_DIR, 'tasks.json'),
  state: path.join(DATA_DIR, 'state.json'),
  calendarConfig: path.join(DATA_DIR, 'calendar-config.json'),
  tokens: path.join(DATA_DIR, 'tokens.json'),
};

const DEFAULT_TASKS = { phases: [] };
const DEFAULT_STATE = {
  zoom: 'Month',
  density: 'Regular',
  collapsed: {},
  activeCalEvents: [],
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
  if (Array.isArray(raw.activeCalEvents)) next.activeCalEvents = raw.activeCalEvents;
  if (Number.isFinite(raw.listWidth)) next.listWidth = raw.listWidth;
  return next;
}

module.exports = {
  DATA_DIR,
  FILES,
  ensureDataDir,
  readTasks() {
    return readJson(FILES.tasks, DEFAULT_TASKS);
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
    return readJson(FILES.calendarConfig, { icalUrls: [] });
  },
  writeCalendarConfig(data) {
    writeJsonAtomic(FILES.calendarConfig, data);
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

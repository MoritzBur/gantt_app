const fs = require('fs');
const path = require('path');
const { DEFAULT_CALENDAR_STORE, normalizeCalendarStore } = require('./calendar/shared');
const runtimePaths = require('./runtime-paths');

const ROOT_DATA_DIR = runtimePaths.resolveDataDir();
let DATA_DIR = ROOT_DATA_DIR;

const FILES = {
  tasks: '',
  state: '',
  personnel: '',
  calendarConfig: '',
  tokens: '',
  notes: '',
};

function setDataDir(nextDataDir) {
  DATA_DIR = path.resolve(nextDataDir || ROOT_DATA_DIR);
  FILES.tasks = path.join(DATA_DIR, 'tasks.json');
  FILES.state = path.join(DATA_DIR, 'state.json');
  FILES.personnel = path.join(DATA_DIR, 'personnel.json');
  FILES.calendarConfig = path.join(DATA_DIR, 'calendar-config.json');
  FILES.tokens = path.join(DATA_DIR, 'tokens.json');
  FILES.notes = path.join(DATA_DIR, 'notes');
  module.exports.DATA_DIR = DATA_DIR;
}

setDataDir(ROOT_DATA_DIR);

const DEFAULT_TASKS = { version: 2, items: [] };
const DEFAULT_PERSONNEL = { version: 1, members: [], teams: [] };
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
  blockerScenarioState: {
    version: 1,
    activeScenarioId: 'default',
    scenarios: [{
      id: 'default',
      name: 'Default',
      calendars: {
        visible: false,
        filterInitialized: false,
        visibleCalendarIds: [],
        activeEventIds: [],
      },
      resources: {
        teamIds: [],
        memberIds: [],
      },
    }],
  },
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

function pruneEmptyDirs(startDir, stopDir) {
  let current = startDir;
  while (current && current !== stopDir && current.startsWith(stopDir)) {
    if (!fs.existsSync(current)) break;
    if (fs.readdirSync(current).length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
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

function getDefaultNoteFile() {
  return 'main.md';
}

function getNodePrefix(node) {
  return node.prefix !== undefined ? node.prefix : (node.type === 'group' ? 'WP' : '');
}

function getNodeNumber(numberPath) {
  return numberPath.join('.');
}

function getNodeLabel(node, numberPath) {
  const prefix = getNodePrefix(node);
  const num = getNodeNumber(numberPath);
  if (prefix) return `${prefix} ${num} ${node.name}`;
  return `${num} ${node.name}`;
}

function ensureNoteFilesInTree(data) {
  if (!data || !Array.isArray(data.items)) return false;

  let changed = false;

  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (node.noteFile !== getDefaultNoteFile(node)) {
        node.noteFile = getDefaultNoteFile(node);
        changed = true;
      }
      if (node.children?.length) visit(node.children);
    }
  };

  visit(data.items);
  return changed;
}

function pruneEmptyDirsDeep(rootDir) {
  if (!fs.existsSync(rootDir)) return false;

  let changed = false;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name));
      }
    }

    if (currentDir === rootDir) return;
    if (fs.readdirSync(currentDir).length === 0) {
      fs.rmdirSync(currentDir);
      changed = true;
    }
  }

  walk(rootDir);
  return changed;
}

function findNodePath(items, id, parents = []) {
  for (let index = 0; index < (items || []).length; index += 1) {
    const item = items[index];
    const nextPath = [...parents, { node: item, index }];
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
  const node = nodePath[nodePath.length - 1]?.node;
  const groups = nodePath.filter((entry) => entry.node?.type === 'group');
  return node?.type === 'group' ? groups.slice(0, -1) : groups;
}

function getStoragePathSegments(itemPath) {
  return itemPath.map((entry, depth) => {
    const numberPath = itemPath.slice(0, depth + 1).map((segment) => segment.index + 1);
    return sanitizePathSegment(getNodeLabel(entry.node, numberPath));
  });
}

function getLegacyStoragePathSegments(itemPath) {
  const nodes = itemPath.map((entry) => entry.node);
  const groups = getAncestorGroupsForNodePath(itemPath).map((entry) => entry.node);
  const node = nodes[nodes.length - 1];
  if (node?.type === 'group') {
    return [...groups.map((group) => sanitizePathSegment(group.id || group.name || 'item')), sanitizePathSegment(node.id || node.name || 'item')];
  }
  return groups.map((group) => sanitizePathSegment(group.id || group.name || 'item'));
}

function getItemDirForNodePath(itemPath) {
  return path.join(FILES.notes, ...getStoragePathSegments(itemPath));
}

function getNoteBinding(data, itemId, options = {}) {
  const itemPath = findNodePath(data?.items || [], itemId);
  if (!itemPath) return null;

  const node = itemPath[itemPath.length - 1].node;
  const shouldAssignDefault = options.assignDefault !== false;
  let changed = false;

  if (!node.noteFile && shouldAssignDefault) {
    node.noteFile = getDefaultNoteFile(node);
    changed = true;
  }

  const itemDir = getItemDirForNodePath(itemPath);
  const noteFile = node.noteFile || getDefaultNoteFile(node);
  const mainPath = path.join(itemDir, noteFile);
  const relatedDir = path.join(itemDir, '_related');

  return {
    itemPath,
    node,
    changed,
    itemDir,
    noteFile,
    mainPath,
    relatedDir,
    groupPath: getStoragePathSegments(itemPath),
  };
}

function collectNoteEntries(data) {
  const notes = [];

  function walk(nodes, numberPath = []) {
    for (let index = 0; index < (nodes || []).length; index += 1) {
      const node = nodes[index];
      const nextNumberPath = [...numberPath, index + 1];
      const label = getNodeLabel(node, nextNumberPath);
      const aliases = Array.from(new Set([
        node.name,
        label,
      ].filter(Boolean)));
      const binding = getNoteBinding({ items: data.items }, node.id, { assignDefault: false });
      if (binding?.noteFile && binding.mainPath) {
        const exists = fs.existsSync(binding.mainPath);
        const hasContent = exists && fs.readFileSync(binding.mainPath, 'utf8').trim().length > 0;
        notes.push({
          itemId: node.id,
          type: 'main',
          filename: binding.noteFile,
          basename: binding.noteFile.replace(/\.md$/i, ''),
          itemName: node.name,
          label,
          aliases,
          path: path.relative(FILES.notes, binding.mainPath),
          exists,
          hasContent,
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
            itemName: node.name,
            label,
            aliases: [filename.replace(/\.md$/i, '')],
            path: path.relative(FILES.notes, path.join(binding.relatedDir, filename)),
            groupPath: binding.groupPath,
          });
        }
      }

      if (node.children?.length) walk(node.children, nextNumberPath);
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

  const candidates = collectNoteEntries(data).filter((entry) => {
    const terms = [entry.basename, ...(entry.aliases || [])]
      .map((value) => String(value || '').trim().replace(/\.md$/i, '').toLowerCase())
      .filter(Boolean);
    return terms.includes(normalized);
  });
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
  const legacyActiveCalEvents = Array.isArray(raw.activeCalEvents)
    ? raw.activeCalEvents.filter((id) => typeof id === 'string' && id.trim())
    : [];
  const legacyResourceFilter = raw.resourceFilter && typeof raw.resourceFilter === 'object'
    ? raw.resourceFilter
    : null;

  if (raw.blockerScenarioState && typeof raw.blockerScenarioState === 'object') {
    const scenarios = Array.isArray(raw.blockerScenarioState.scenarios)
      ? raw.blockerScenarioState.scenarios
        .map((scenario, index) => {
          const scenarioId = typeof scenario?.id === 'string' && scenario.id.trim()
            ? scenario.id.trim()
            : `scenario-${index + 1}`;
          return {
            id: scenarioId,
            name: typeof scenario?.name === 'string' && scenario.name.trim()
              ? scenario.name.trim()
              : `Scenario ${index + 1}`,
            calendars: {
              visible: !!scenario?.calendars?.visible,
              filterInitialized: scenario?.calendars?.filterInitialized === true ||
                (
                  Array.isArray(scenario?.calendars?.visibleCalendarIds) &&
                  scenario.calendars.visibleCalendarIds.length > 0
                ),
              visibleCalendarIds: Array.isArray(scenario?.calendars?.visibleCalendarIds)
                ? scenario.calendars.visibleCalendarIds.filter((id) => typeof id === 'string' && id.trim())
                : [],
              activeEventIds: Array.isArray(scenario?.calendars?.activeEventIds)
                ? scenario.calendars.activeEventIds.filter((id) => typeof id === 'string' && id.trim())
                : Array.isArray(scenario?.calendars?.selectedIds)
                  ? scenario.calendars.selectedIds.filter((id) => typeof id === 'string' && id.trim())
                : [],
            },
            resources: {
              teamIds: Array.isArray(scenario?.resources?.teamIds)
                ? scenario.resources.teamIds.filter((id) => typeof id === 'string' && id.trim())
                : [],
              memberIds: Array.isArray(scenario?.resources?.memberIds)
                ? scenario.resources.memberIds.filter((id) => typeof id === 'string' && id.trim())
                : [],
            },
          };
        })
        .filter((scenario) => scenario.id)
      : [];

    if (scenarios.length > 0) {
      const activeScenarioId = typeof raw.blockerScenarioState.activeScenarioId === 'string' && raw.blockerScenarioState.activeScenarioId.trim()
        ? raw.blockerScenarioState.activeScenarioId.trim()
        : scenarios[0].id;
      next.blockerScenarioState = {
        version: 1,
        activeScenarioId: scenarios.some((scenario) => scenario.id === activeScenarioId) ? activeScenarioId : scenarios[0].id,
        scenarios,
      };
    }
  } else {
    const defaultScenario = { ...next.blockerScenarioState.scenarios[0] };
    const legacyVisibleCalendarIds = raw.calendarOrder && Array.isArray(raw.calendarOrder)
      ? raw.calendarOrder.filter((id) => typeof id === 'string' && id.trim())
      : [];
    defaultScenario.calendars = {
      visible: legacyActiveCalEvents.length > 0,
      filterInitialized: legacyVisibleCalendarIds.length > 0,
      visibleCalendarIds: legacyVisibleCalendarIds,
      activeEventIds: legacyActiveCalEvents,
    };
    if (legacyResourceFilter) {
      const mode = legacyResourceFilter.mode;
      const id = typeof legacyResourceFilter.id === 'string' && legacyResourceFilter.id.trim()
        ? legacyResourceFilter.id.trim()
        : null;
      if (mode === 'team' && id) defaultScenario.resources.teamIds = [id];
      if (mode === 'member' && id) defaultScenario.resources.memberIds = [id];
    }
    next.blockerScenarioState = {
      version: 1,
      activeScenarioId: 'default',
      scenarios: [defaultScenario],
    };
  }
  next.notePanel = mergeNotePanelState(raw.notePanel);
  return next;
}

function normalizeTaskPlanningFields(node) {
  if (!node || typeof node !== 'object') return false;

  let changed = false;

  if (node.type === 'task') {
    if (!Object.prototype.hasOwnProperty.call(node, 'assigneeId')) {
      node.assigneeId = null;
      changed = true;
    } else if (node.assigneeId !== null && typeof node.assigneeId !== 'string') {
      node.assigneeId = String(node.assigneeId || '').trim() || null;
      changed = true;
    }

    if (!Object.prototype.hasOwnProperty.call(node, 'blocker')) {
      node.blocker = false;
      changed = true;
    } else if (typeof node.blocker !== 'boolean') {
      node.blocker = !!node.blocker;
      changed = true;
    }
  }

  for (const child of node.children || []) {
    if (normalizeTaskPlanningFields(child)) changed = true;
  }

  return changed;
}

function normalizeFieldEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      key: typeof entry?.key === 'string' ? entry.key.trim() : '',
      value: typeof entry?.value === 'string' ? entry.value : '',
    }))
    .filter((entry) => entry.key || entry.value);
}

function normalizePersonnel(raw) {
  const base = raw && typeof raw === 'object' ? raw : DEFAULT_PERSONNEL;
  const teams = Array.isArray(base.teams)
    ? base.teams
      .map((team) => ({
        id: typeof team?.id === 'string' && team.id.trim() ? team.id.trim() : null,
        name: typeof team?.name === 'string' ? team.name.trim() : '',
        comment: typeof team?.comment === 'string' ? team.comment : '',
        fields: normalizeFieldEntries(team?.fields),
      }))
      .filter((team) => team.id && team.name)
    : [];

  const validTeamIds = new Set(teams.map((team) => team.id));
  const members = Array.isArray(base.members)
    ? base.members
      .map((member) => ({
        id: typeof member?.id === 'string' && member.id.trim() ? member.id.trim() : null,
        name: typeof member?.name === 'string' ? member.name.trim() : '',
        comment: typeof member?.comment === 'string' ? member.comment : '',
        teamIds: Array.isArray(member?.teamIds)
          ? Array.from(new Set(member.teamIds.map((teamId) => String(teamId || '').trim()).filter((teamId) => validTeamIds.has(teamId))))
          : [],
        fields: normalizeFieldEntries(member?.fields),
      }))
      .filter((member) => member.id && member.name)
    : [];

  return {
    version: 1,
    teams,
    members,
  };
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
        const legacyGroupDir = path.join(FILES.notes, ...getLegacyStoragePathSegments(binding.itemPath));
        const parentItemDir = binding.itemPath.length > 1
          ? getItemDirForNodePath(binding.itemPath.slice(0, -1))
          : FILES.notes;
        const topLevelItemDir = binding.itemPath.length > 0
          ? getItemDirForNodePath(binding.itemPath.slice(0, 1))
          : FILES.notes;
        const legacyNestedSegments = getLegacyStoragePathSegments(binding.itemPath).slice(1);
        const legacyDefaultMainName = node.type === 'group'
          ? '_phase.md'
          : `${sanitizePathSegment(node.id || node.name || 'note')}.md`;
        const strandedRelatedMainPath = node.type === 'group'
          ? path.join(parentItemDir, '_related', sanitizePathSegment(node.id || node.name || 'item'), '_phase.md')
          : path.join(parentItemDir, '_related', legacyDefaultMainName);
        const legacyNestedStrandedMainPath = path.join(topLevelItemDir, '_related', ...legacyNestedSegments, legacyDefaultMainName);
        const legacyMainCandidates = Array.from(new Set([
          path.join(FILES.notes, binding.noteFile),
          path.join(legacyGroupDir, binding.noteFile),
          path.join(legacyGroupDir, legacyDefaultMainName),
          path.join(binding.itemDir, legacyDefaultMainName),
          path.join(binding.itemDir, '_main.md'),
          strandedRelatedMainPath,
          legacyNestedStrandedMainPath,
        ]));

        for (const legacyMainPath of legacyMainCandidates) {
          if (legacyMainPath === binding.mainPath || !fs.existsSync(legacyMainPath)) continue;

          if (!fs.existsSync(binding.mainPath)) {
            fs.mkdirSync(path.dirname(binding.mainPath), { recursive: true });
            fs.renameSync(legacyMainPath, binding.mainPath);
            changed = true;
            break;
          }

          if (fs.readFileSync(legacyMainPath, 'utf8') === fs.readFileSync(binding.mainPath, 'utf8')) {
            fs.unlinkSync(legacyMainPath);
            pruneEmptyDirs(path.dirname(legacyMainPath), FILES.notes);
            changed = true;
          }
        }

        const legacyRelatedCandidates = Array.from(new Set([
          path.join(FILES.notes, sanitizePathSegment(node.id || 'item')),
          path.join(legacyGroupDir, '_related'),
          path.join(legacyGroupDir, sanitizePathSegment(node.id || 'item')),
          path.join(parentItemDir, '_related', sanitizePathSegment(node.id || 'item'), '_related'),
          path.join(topLevelItemDir, '_related', ...legacyNestedSegments, '_related'),
        ]));

        for (const legacyRelatedDir of legacyRelatedCandidates) {
          if (
            legacyRelatedDir === binding.relatedDir ||
            !fs.existsSync(legacyRelatedDir) ||
            fs.existsSync(binding.relatedDir)
          ) {
            continue;
          }
          fs.mkdirSync(path.dirname(binding.relatedDir), { recursive: true });
          fs.renameSync(legacyRelatedDir, binding.relatedDir);
          changed = true;
          break;
        }
      }

      if (node.children?.length) walk(node.children);
    }
  }

  walk(data.items);
  if (pruneEmptyDirsDeep(FILES.notes)) {
    changed = true;
  }
  return changed;
}

module.exports = {
  ROOT_DATA_DIR,
  DATA_DIR,
  FILES,
  MAX_DEPTH,
  DEFAULT_TASKS,
  DEFAULT_PERSONNEL,
  DEFAULT_STATE,
  ensureDataDir,
  ensureNotesDir,
  findNode,
  findNodePath,
  getNodeDepth,
  calcGroupBounds,
  recomputeAncestorBounds,
  migrateV1toV2,
  setDataDir,
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
      const relocated = relocateLegacyNoteFiles(normalized);
      const notesChanged = ensureNoteFilesInTree(normalized);
      const planningChanged = (normalized.items || []).some((node) => normalizeTaskPlanningFields(node));
      if (relocated || notesChanged || planningChanged) {
        writeJsonAtomic(FILES.tasks, normalized);
      }
      return normalized;
    }
    const migrated = migrateInlineNotesToFiles(raw, originalSnapshot);
    const relocated = relocateLegacyNoteFiles(migrated);
    const notesChanged = ensureNoteFilesInTree(migrated);
    const planningChanged = (migrated.items || []).some((node) => normalizeTaskPlanningFields(node));
    if (relocated || notesChanged || planningChanged) {
      writeJsonAtomic(FILES.tasks, migrated);
    }
    return migrated;
  },
  writeTasks(data) {
    ensureNoteFilesInTree(data);
    for (const node of data.items || []) normalizeTaskPlanningFields(node);
    writeJsonAtomic(FILES.tasks, data);
  },
  readPersonnel() {
    return normalizePersonnel(readJson(FILES.personnel, DEFAULT_PERSONNEL));
  },
  writePersonnel(data) {
    writeJsonAtomic(FILES.personnel, normalizePersonnel(data));
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

const fs = require('fs');
const path = require('path');
const store = require('./data-store');

const WORKSPACES_ROOT = path.join(store.ROOT_DATA_DIR, 'workspaces');
const MANIFEST_FILE = path.join(store.ROOT_DATA_DIR, 'workspaces.json');
const EXAMPLE_TEMPLATES_ROOT = path.join(__dirname, 'workspace-templates');
const EXAMPLE_WORKSPACES = [
  {
    id: 'app-guide',
    name: 'App Guide & Walkthrough',
    templateDir: path.join(EXAMPLE_TEMPLATES_ROOT, 'app-guide'),
  },
  {
    id: 'sailor-thesis',
    name: 'Sailor Thesis, Racing & Notes',
    templateDir: path.join(EXAMPLE_TEMPLATES_ROOT, 'aero-thesis'),
  },
  {
    id: 'store-support',
    name: 'Multi-Client Store Support',
    templateDir: path.join(EXAMPLE_TEMPLATES_ROOT, 'store-support'),
  },
  {
    id: 'mechanics-coordination',
    name: 'Mechanics Coordination',
    templateDir: path.join(EXAMPLE_TEMPLATES_ROOT, 'mechanics-coordination'),
  },
  {
    id: 'club-coach',
    name: 'Chief Coach of Sailing Club',
    templateDir: path.join(EXAMPLE_TEMPLATES_ROOT, 'club-coach'),
  },
];
const DEFAULT_EXAMPLE_TEMPLATE_DIR = EXAMPLE_WORKSPACES[0]?.templateDir || '';
const EXAMPLE_TEMPLATE_DIR = DEFAULT_EXAMPLE_TEMPLATE_DIR;

function sanitizeWorkspaceId(value) {
  return String(value || 'workspace')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function workspaceDir(workspaceId) {
  return path.join(WORKSPACES_ROOT, workspaceId);
}

function buildWorkspaceRecord({ id, name, kind = 'user', pathMode = 'workspace' }) {
  return {
    id,
    name,
    kind,
    pathMode,
    path: pathMode === 'root' ? store.ROOT_DATA_DIR : workspaceDir(id),
  };
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function listLegacyEntries() {
  const candidates = [
    'tasks.json',
    'state.json',
    'calendar-config.json',
    'tokens.json',
    'notes',
    'tasks.v1.backup.json',
    'tasks.inline-notes.backup.json',
  ];

  return candidates
    .map((name) => ({ name, fullPath: path.join(store.ROOT_DATA_DIR, name) }))
    .filter((entry) => fs.existsSync(entry.fullPath));
}

function writeEmptyWorkspaceFiles(dirPath) {
  ensureDir(dirPath);
  writeJson(path.join(dirPath, 'tasks.json'), store.DEFAULT_TASKS);
  writeJson(path.join(dirPath, 'state.json'), store.DEFAULT_STATE);
  writeJson(path.join(dirPath, 'personnel.json'), store.DEFAULT_PERSONNEL);
  writeJson(path.join(dirPath, 'calendar-config.json'), {
    version: 2,
    backends: {
      ical: { calendars: [] },
      google: { calendars: [] },
    },
  });
  ensureDir(path.join(dirPath, 'notes'));
}

function writeStarterMainWorkspaceFiles(dirPath) {
  ensureDir(dirPath);
  copyDirContents(path.join(EXAMPLE_TEMPLATES_ROOT, 'main-starter'), dirPath, { overwrite: true });
}

function copyDirContents(sourceDir, targetDir, { overwrite = true } = {}) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(sourcePath, targetPath, { overwrite });
    } else {
      if (!overwrite && fs.existsSync(targetPath)) continue;
      ensureDir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function cloneWorkspaceContents(sourceDir, targetDir) {
  copyDirContents(sourceDir, targetDir);
}

function getExampleTemplate(workspaceId) {
  return EXAMPLE_WORKSPACES.find((template) => template.id === workspaceId) || null;
}

function ensureWorkspaceFiles(workspace) {
  if (!workspace) return;

  const exampleTemplate = workspace.kind === 'example' ? getExampleTemplate(workspace.id) : null;
  if (exampleTemplate && fs.existsSync(exampleTemplate.templateDir)) {
    ensureDir(workspace.path);
    copyDirContents(exampleTemplate.templateDir, workspace.path, { overwrite: false });
    return;
  }

  ensureDir(workspace.path);

  const tasksFile = path.join(workspace.path, 'tasks.json');
  const stateFile = path.join(workspace.path, 'state.json');
  const calendarFile = path.join(workspace.path, 'calendar-config.json');
  const personnelFile = path.join(workspace.path, 'personnel.json');
  const notesDir = path.join(workspace.path, 'notes');

  if (!fs.existsSync(tasksFile)) writeJson(tasksFile, store.DEFAULT_TASKS);
  if (!fs.existsSync(stateFile)) writeJson(stateFile, store.DEFAULT_STATE);
  if (!fs.existsSync(personnelFile)) writeJson(personnelFile, store.DEFAULT_PERSONNEL);
  if (!fs.existsSync(calendarFile)) {
    writeJson(calendarFile, {
      version: 2,
      backends: {
        ical: { calendars: [] },
        google: { calendars: [] },
      },
    });
  }
  ensureDir(notesDir);
}

function readManifest() {
  const raw = readJson(MANIFEST_FILE, null);
  if (!raw || !Array.isArray(raw.workspaces)) return null;
  return {
    activeWorkspaceId: raw.activeWorkspaceId || raw.workspaces[0]?.id || null,
    workspaces: raw.workspaces
      .filter((workspace) => workspace && workspace.id && workspace.name)
      .map((workspace) => buildWorkspaceRecord(workspace)),
  };
}

function writeManifest(manifest) {
  writeJson(MANIFEST_FILE, {
    activeWorkspaceId: manifest.activeWorkspaceId,
    workspaces: manifest.workspaces.map(({ id, name, kind, pathMode }) => ({ id, name, kind, pathMode })),
  });
}

function ensureExampleWorkspace(manifest) {
  let next = { ...manifest, workspaces: [...manifest.workspaces] };

  for (const example of EXAMPLE_WORKSPACES) {
    if (!fs.existsSync(example.templateDir)) continue;
    if (next.workspaces.some((workspace) => workspace.id === example.id)) continue;
    next.workspaces.push(buildWorkspaceRecord({
      id: example.id,
      name: example.name,
      kind: 'example',
    }));
    cloneWorkspaceContents(example.templateDir, workspaceDir(example.id));
  }

  return next;
}

function initializeWorkspaceManifest() {
  ensureDir(store.ROOT_DATA_DIR);

  let manifest = readManifest();
  if (manifest) {
    const nextManifest = ensureExampleWorkspace(manifest);
    if ((nextManifest.workspaces || []).length !== (manifest.workspaces || []).length) {
      writeManifest(nextManifest);
    }
    return nextManifest;
  }

  const legacyEntries = listLegacyEntries();
  const hasLegacyData = legacyEntries.length > 0;

  if (hasLegacyData) {
    const legacyManifest = {
      activeWorkspaceId: 'main',
      workspaces: [buildWorkspaceRecord({
        id: 'main',
        name: 'Main Workspace',
        kind: 'user',
        pathMode: 'root',
      })],
    };
    const withExample = ensureExampleWorkspace(legacyManifest);
    writeManifest(withExample);
    return withExample;
  }

  ensureDir(WORKSPACES_ROOT);
  manifest = {
    activeWorkspaceId: 'main',
    workspaces: [buildWorkspaceRecord({
      id: 'main',
      name: 'Main Workspace',
      kind: 'user',
    })],
  };

  writeStarterMainWorkspaceFiles(manifest.workspaces[0].path);
  manifest = ensureExampleWorkspace(manifest);
  if (EXAMPLE_WORKSPACES.length > 0 && manifest.workspaces.some((workspace) => workspace.id === EXAMPLE_WORKSPACES[0].id)) {
    manifest.activeWorkspaceId = EXAMPLE_WORKSPACES[0].id;
  }

  writeManifest(manifest);
  return manifest;
}

function ensureInitialized() {
  const manifest = initializeWorkspaceManifest();
  manifest.workspaces.forEach(ensureWorkspaceFiles);
  const active = manifest.workspaces.find((workspace) => workspace.id === manifest.activeWorkspaceId) || manifest.workspaces[0];
  if (!active) {
    throw new Error('No workspace available');
  }
  ensureWorkspaceFiles(active);
  store.setDataDir(active.path);
  return {
    ...manifest,
    activeWorkspace: active,
  };
}

function listWorkspaces() {
  const manifest = ensureInitialized();
  return {
    activeWorkspaceId: manifest.activeWorkspaceId,
    activeWorkspace: manifest.workspaces.find((workspace) => workspace.id === manifest.activeWorkspaceId) || null,
    workspaces: manifest.workspaces,
  };
}

function setActiveWorkspace(workspaceId) {
  const manifest = ensureInitialized();
  const active = manifest.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!active) {
    throw new Error('Workspace not found');
  }
  if (fs.existsSync(MANIFEST_FILE) || active.id !== 'main') {
    manifest.activeWorkspaceId = active.id;
    writeManifest(manifest);
  }
  store.setDataDir(active.path);
  return {
    activeWorkspaceId: active.id,
    activeWorkspace: active,
    workspaces: manifest.workspaces,
  };
}

function getUniqueWorkspaceId(baseId, manifest) {
  const used = new Set((manifest.workspaces || []).map((workspace) => workspace.id));
  if (!used.has(baseId)) return baseId;
  let index = 2;
  while (used.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function canDeleteWorkspace(workspaceId, manifest = null) {
  const currentManifest = manifest || ensureInitialized();
  const workspace = currentManifest.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return false;
  if (workspace.pathMode === 'root') return false;
  if ((currentManifest.workspaces || []).length <= 1) return false;
  return true;
}

function createWorkspace({ name, mode = 'empty', sourceWorkspaceId = null }) {
  const manifest = ensureInitialized();
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error('Workspace name is required');
  }

  const workspaceId = getUniqueWorkspaceId(sanitizeWorkspaceId(trimmedName), manifest);
  const nextWorkspace = buildWorkspaceRecord({
    id: workspaceId,
    name: trimmedName,
    kind: mode === 'example' ? 'example' : 'user',
  });

  if (mode === 'clone') {
    const source = manifest.workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
    if (!source) throw new Error('Source workspace not found');
    cloneWorkspaceContents(source.path, nextWorkspace.path);
  } else if (mode === 'example') {
    if (!fs.existsSync(DEFAULT_EXAMPLE_TEMPLATE_DIR)) throw new Error('Example template is not available');
    cloneWorkspaceContents(DEFAULT_EXAMPLE_TEMPLATE_DIR, nextWorkspace.path);
  } else {
    writeEmptyWorkspaceFiles(nextWorkspace.path);
  }

  const nextManifest = {
    activeWorkspaceId: nextWorkspace.id,
    workspaces: [...manifest.workspaces, nextWorkspace],
  };
  writeManifest(nextManifest);
  store.setDataDir(nextWorkspace.path);
  return {
    activeWorkspaceId: nextWorkspace.id,
    activeWorkspace: nextWorkspace,
    workspaces: nextManifest.workspaces,
  };
}

function deleteWorkspace(workspaceId) {
  const manifest = ensureInitialized();
  const workspaceIndex = manifest.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error('Workspace not found');
  }
  if (!canDeleteWorkspace(workspaceId, manifest)) {
    throw new Error('This workspace cannot be deleted');
  }

  const workspace = manifest.workspaces[workspaceIndex];
  if (workspace.pathMode !== 'root' && fs.existsSync(workspace.path)) {
    fs.rmSync(workspace.path, { recursive: true, force: true });
  }

  const nextWorkspaces = manifest.workspaces.filter((entry) => entry.id !== workspaceId);
  const nextActiveWorkspace = manifest.activeWorkspaceId === workspaceId
    ? (nextWorkspaces[workspaceIndex] || nextWorkspaces[workspaceIndex - 1] || nextWorkspaces[0] || null)
    : (nextWorkspaces.find((entry) => entry.id === manifest.activeWorkspaceId) || nextWorkspaces[0] || null);

  const nextManifest = {
    activeWorkspaceId: nextActiveWorkspace?.id || null,
    workspaces: nextWorkspaces,
  };

  writeManifest(nextManifest);
  if (nextActiveWorkspace) {
    ensureWorkspaceFiles(nextActiveWorkspace);
    store.setDataDir(nextActiveWorkspace.path);
  }

  return {
    activeWorkspaceId: nextActiveWorkspace?.id || null,
    activeWorkspace: nextActiveWorkspace,
    workspaces: nextWorkspaces,
  };
}

module.exports = {
  WORKSPACES_ROOT,
  MANIFEST_FILE,
  EXAMPLE_TEMPLATE_DIR,
  EXAMPLE_WORKSPACES,
  ensureInitialized,
  listWorkspaces,
  setActiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  canDeleteWorkspace,
};

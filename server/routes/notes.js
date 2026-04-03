const fs = require('fs');
const path = require('path');
const express = require('express');
const store = require('../data-store');
const runtimePaths = require('../runtime-paths');
const workspaceManager = require('../workspace-manager');

const router = express.Router();

function normalizeFilename(value, fallback = 'note') {
  const basename = path.basename(String(value || fallback).trim());
  const safe = basename
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80) || fallback;

  return safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`;
}

function readTextFile(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch (err) {
    throw new Error(`Failed to read note file: ${err.message}`);
  }
}

function ensureMainBinding(data, itemId) {
  const binding = store.getNoteBinding(data, itemId);
  if (!binding) return null;
  if (binding.changed) store.writeTasks(data);
  return binding;
}

function toWorkspacePath(filePath) {
  if (!filePath) return null;
  const relative = path.relative(runtimePaths.REPO_ROOT, filePath);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return filePath;
}

function hasWorkspaceMismatch(req) {
  const requestedWorkspaceId = String(req.get('x-workspace-id') || '').trim();
  if (!requestedWorkspaceId) return false;
  return workspaceManager.listWorkspaces().activeWorkspaceId !== requestedWorkspaceId;
}

function rejectWorkspaceMismatch(req, res) {
  if (!hasWorkspaceMismatch(req)) return false;
  res.status(409).json({ error: 'Workspace changed while this note request was in flight' });
  return true;
}

router.get('/all', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    res.json({
      notes: store.collectNoteEntries(data).map((note) => ({
        ...note,
        workspacePath: note.path ? toWorkspacePath(path.join(store.FILES.notes, note.path)) : null,
      })),
    });
  } catch (err) {
    console.error('Failed to list notes:', err);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

router.get('/resolve', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const fromItemId = String(req.query.fromItemId || '').trim();
    const link = String(req.query.link || '').trim();
    if (!fromItemId || !link) {
      return res.status(400).json({ error: 'fromItemId and link are required' });
    }

    const data = store.readTasks();
    const resolved = store.resolveLinkTarget(data, fromItemId, link);
    if (!resolved) return res.status(404).json({ error: 'Note link target not found' });
    res.json(resolved);
  } catch (err) {
    console.error('Failed to resolve note link:', err);
    res.status(500).json({ error: 'Failed to resolve note link' });
  }
});

router.get('/:itemId/related', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const binding = store.getNoteBinding(data, req.params.itemId, { assignDefault: false });
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    const files = fs.existsSync(binding.relatedDir)
      ? fs.readdirSync(binding.relatedDir)
        .filter((name) => name.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.localeCompare(b))
      : [];

    res.json({ itemId: req.params.itemId, files });
  } catch (err) {
    console.error('Failed to list related notes:', err);
    res.status(500).json({ error: 'Failed to list related notes' });
  }
});

router.post('/:itemId/related', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const binding = store.getNoteBinding(data, req.params.itemId, { assignDefault: false });
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    const filename = normalizeFilename(req.body?.filename, 'untitled');
    const filePath = path.join(binding.relatedDir, filename);
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ error: 'Related note already exists', filename });
    }

    store.writeTextAtomic(filePath, String(req.body?.content || ''));
    res.status(201).json({
      itemId: req.params.itemId,
      type: 'related',
      filename,
      workspacePath: toWorkspacePath(filePath),
      content: String(req.body?.content || ''),
    });
  } catch (err) {
    console.error('Failed to create related note:', err);
    res.status(500).json({ error: 'Failed to create related note' });
  }
});

router.get('/:itemId/related/:filename', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const binding = store.getNoteBinding(data, req.params.itemId, { assignDefault: false });
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    const filename = normalizeFilename(req.params.filename);
    const filePath = path.join(binding.relatedDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Related note not found' });
    }

    res.json({
      itemId: req.params.itemId,
      type: 'related',
      filename,
      workspacePath: toWorkspacePath(filePath),
      content: readTextFile(filePath),
    });
  } catch (err) {
    console.error('Failed to read related note:', err);
    res.status(500).json({ error: 'Failed to read related note' });
  }
});

router.put('/:itemId/related/:filename', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const binding = store.getNoteBinding(data, req.params.itemId, { assignDefault: false });
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    const filename = normalizeFilename(req.params.filename);
    const filePath = path.join(binding.relatedDir, filename);
    store.writeTextAtomic(filePath, String(req.body?.content || ''));

    res.json({
      itemId: req.params.itemId,
      type: 'related',
      filename,
      workspacePath: toWorkspacePath(filePath),
      content: String(req.body?.content || ''),
    });
  } catch (err) {
    console.error('Failed to save related note:', err);
    res.status(500).json({ error: 'Failed to save related note' });
  }
});

router.get('/:itemId', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const ensure = req.query.ensure === '1';
    const binding = ensure ? ensureMainBinding(data, req.params.itemId) : store.getNoteBinding(data, req.params.itemId, { assignDefault: false });
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    if (ensure && binding.mainPath && !fs.existsSync(binding.mainPath)) {
      store.writeTextAtomic(binding.mainPath, '');
    }

    res.json({
      itemId: req.params.itemId,
      type: 'main',
      filename: binding.noteFile || null,
      workspacePath: toWorkspacePath(binding.mainPath),
      exists: !!(binding.mainPath && fs.existsSync(binding.mainPath)),
      content: binding.mainPath ? readTextFile(binding.mainPath) : '',
    });
  } catch (err) {
    console.error('Failed to read note:', err);
    res.status(500).json({ error: 'Failed to read note' });
  }
});

router.put('/:itemId', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const data = store.readTasks();
    const binding = ensureMainBinding(data, req.params.itemId);
    if (!binding) return res.status(404).json({ error: 'Item not found' });

    const content = String(req.body?.content || '');
    store.writeTextAtomic(binding.mainPath, content);

    res.json({
      itemId: req.params.itemId,
      type: 'main',
      filename: binding.noteFile,
      workspacePath: toWorkspacePath(binding.mainPath),
      content,
    });
  } catch (err) {
    console.error('Failed to save note:', err);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

module.exports = router;

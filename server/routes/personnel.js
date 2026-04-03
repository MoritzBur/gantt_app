const express = require('express');
const store = require('../data-store');
const workspaceManager = require('../workspace-manager');

const router = express.Router();

function rejectWorkspaceMismatch(req, res) {
  const requestedWorkspaceId = String(req.get('x-workspace-id') || '').trim();
  if (!requestedWorkspaceId) return false;
  if (workspaceManager.listWorkspaces().activeWorkspaceId === requestedWorkspaceId) return false;
  res.status(409).json({ error: 'Workspace changed while this personnel request was in flight' });
  return true;
}

router.get('/', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    res.json(store.readPersonnel());
  } catch (err) {
    console.error('Failed to read personnel:', err);
    res.status(500).json({ error: 'Failed to read personnel' });
  }
});

router.put('/', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const next = req.body || {};
    store.writePersonnel(next);
    res.json(store.readPersonnel());
  } catch (err) {
    console.error('Failed to write personnel:', err);
    res.status(500).json({ error: 'Failed to write personnel' });
  }
});

module.exports = router;

const express = require('express');
const workspaceManager = require('../workspace-manager');

const router = express.Router();

function serialize(payload) {
  return {
    activeWorkspaceId: payload.activeWorkspaceId,
    activeWorkspace: payload.activeWorkspace
      ? {
          id: payload.activeWorkspace.id,
          name: payload.activeWorkspace.name,
          kind: payload.activeWorkspace.kind,
        }
      : null,
    workspaces: (payload.workspaces || []).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      kind: workspace.kind,
    })),
  };
}

router.get('/', (_req, res) => {
  try {
    const payload = workspaceManager.listWorkspaces();
    res.json(serialize(payload));
  } catch (err) {
    console.error('Failed to list workspaces:', err);
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

router.post('/active', (req, res) => {
  try {
    const workspaceId = String(req.body?.workspaceId || '').trim();
    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }
    const payload = workspaceManager.setActiveWorkspace(workspaceId);
    res.json(serialize(payload));
  } catch (err) {
    if (/not found/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    console.error('Failed to switch workspace:', err);
    res.status(500).json({ error: 'Failed to switch workspace' });
  }
});

router.post('/', (req, res) => {
  try {
    const payload = workspaceManager.createWorkspace({
      name: req.body?.name,
      mode: req.body?.mode,
      sourceWorkspaceId: req.body?.sourceWorkspaceId || null,
    });
    res.status(201).json(serialize(payload));
  } catch (err) {
    if (/required|not found|not available/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Failed to create workspace:', err);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

module.exports = router;

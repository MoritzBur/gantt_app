const express = require('express');
const fs = require('fs');
const store = require('../data-store');
const workspaceManager = require('../workspace-manager');

const router = express.Router();

function rejectWorkspaceMismatch(req, res) {
  const requestedWorkspaceId = String(req.get('x-workspace-id') || '').trim();
  if (!requestedWorkspaceId) return false;
  if (workspaceManager.listWorkspaces().activeWorkspaceId === requestedWorkspaceId) return false;
  res.status(409).json({ error: 'Workspace changed while this state request was in flight' });
  return true;
}

router.get('/', (req, res) => {
  if (rejectWorkspaceMismatch(req, res)) return;
  let rawState = null;
  try {
    if (fs.existsSync(store.FILES.state)) {
      rawState = JSON.parse(fs.readFileSync(store.FILES.state, 'utf8'));
    }
  } catch (_) {}

  const needsCalendarStateMigration = !!rawState && rawState.calendarEventIdsVersion !== 2;
  const hasLegacyCalendarEventIds = needsCalendarStateMigration &&
    Array.isArray(rawState.activeCalEvents) &&
    rawState.activeCalEvents.length > 0;

  res.json({
    ...store.readUiState(),
    _exists: fs.existsSync(store.FILES.state),
    _calendarStateNeedsMigration: needsCalendarStateMigration,
    _legacyCalendarEventIds: hasLegacyCalendarEventIds,
  });
});

router.put('/', (req, res) => {
  try {
    if (rejectWorkspaceMismatch(req, res)) return;
    const next = { ...store.readUiState(), ...(req.body || {}) };
    store.writeUiState(next);
    res.json(store.readUiState());
  } catch (err) {
    console.error('Failed to save UI state:', err);
    res.status(500).json({ error: 'Failed to save UI state' });
  }
});

module.exports = router;

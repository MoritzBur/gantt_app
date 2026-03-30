const express = require('express');
const fs = require('fs');
const store = require('../data-store');

const router = express.Router();

router.get('/', (_req, res) => {
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
    const next = { ...store.readUiState(), ...(req.body || {}) };
    store.writeUiState(next);
    res.json(store.readUiState());
  } catch (err) {
    console.error('Failed to save UI state:', err);
    res.status(500).json({ error: 'Failed to save UI state' });
  }
});

module.exports = router;

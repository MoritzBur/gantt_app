const express = require('express');
const fs = require('fs');
const store = require('../data-store');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    ...store.readUiState(),
    _exists: fs.existsSync(store.FILES.state),
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

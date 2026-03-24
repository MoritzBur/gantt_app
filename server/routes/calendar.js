const express = require('express');
const router = express.Router();
const calendar = require('../calendar');

const BACKEND = process.env.CALENDAR_BACKEND || 'ical';

// GET /api/calendar/status
router.get('/status', (req, res) => {
  res.json({
    connected: calendar.isConnected(),
    authUrl: calendar.getAuthUrl(),
    backend: BACKEND,
  });
});

// GET /api/calendar/config
router.get('/config', (req, res) => {
  res.json(calendar.getConfig());
});

// POST /api/calendar/config
router.post('/config', async (req, res) => {
  try {
    await calendar.configure(req.body);
    res.json({ connected: calendar.isConnected() });
  } catch (err) {
    console.error('Calendar config failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calendar/auth — redirect to provider auth (Google only)
router.get('/auth', (req, res) => {
  const url = calendar.getAuthUrl();
  if (!url) return res.redirect('/?calendarError=auth_not_supported');
  res.redirect(url);
});

// GET /api/calendar/callback — exchange code for tokens (Google only)
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?calendarError=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?calendarError=no_code');
  try {
    await calendar.handleCallback(code);
    res.redirect('/');
  } catch (err) {
    console.error('Calendar callback failed:', err);
    res.redirect('/?calendarError=token_exchange_failed');
  }
});

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/events', async (req, res) => {
  if (!calendar.isConnected()) {
    return res.status(401).json({ error: 'Calendar not connected' });
  }
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end query params required' });
  }
  try {
    const events = await calendar.getEvents(start, end);
    res.json(events);
  } catch (err) {
    console.error('Failed to fetch calendar events:', err);
    if (err.code === 401) {
      return res.status(401).json({ error: 'Token expired or revoked. Please reconnect.' });
    }
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

// POST /api/calendar/disconnect
router.post('/disconnect', (req, res) => {
  calendar.disconnect();
  res.json({ ok: true });
});

module.exports = router;

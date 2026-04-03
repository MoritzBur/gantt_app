const nodeIcal = require('node-ical');
const store = require('../data-store');
const { normalizeBackendCalendars, toPublicCalendarConfig } = require('./shared');

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const workspaceCache = new Map();

function loadCalendars() {
  const config = store.readCalendarConfig();
  const storedCalendars = config.backends?.ical?.calendars || [];
  if (storedCalendars.length > 0) {
    return normalizeBackendCalendars(storedCalendars, 'ical');
  }

  const envUrls = (process.env.ICAL_URLS || '')
    .split(',')
    .map(url => url.trim())
    .filter(Boolean);

  return normalizeBackendCalendars(
    envUrls.map(icalUrl => ({ icalUrl })),
    'ical'
  );
}

function saveCalendars(nextCalendars) {
  const config = store.readCalendarConfig();
  store.writeCalendarConfig({
    ...config,
    backends: {
      ...config.backends,
      ical: {
        calendars: normalizeBackendCalendars(nextCalendars, 'ical'),
      },
    },
  });
}

function getWorkspaceKey() {
  return store.DATA_DIR;
}

function getWorkspaceState() {
  const workspaceKey = getWorkspaceKey();
  if (!workspaceCache.has(workspaceKey)) {
    workspaceCache.set(workspaceKey, {
      calendars: loadCalendars(),
      cache: null,
      lastFetchOk: false,
    });
  }
  return workspaceCache.get(workspaceKey);
}

function formatLocalDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateOnly(d) {
  return d instanceof Date &&
    d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

async function fetchAll(calendars) {
  const allEvents = [];
  const enabledCalendars = calendars.filter(calendar => calendar.enabled !== false && calendar.icalUrl);

  for (const calendar of enabledCalendars) {
    try {
      const data = await nodeIcal.async.fromURL(calendar.icalUrl);
      for (const [key, ev] of Object.entries(data)) {
        if (ev.type !== 'VEVENT' || !ev.start) continue;

        const allDay = isDateOnly(ev.start);
        const startStr = formatLocalDate(ev.start);
        const sourceEventId = ev.uid || key;

        const rawEnd = ev.end ? new Date(ev.end) : new Date(ev.start);
        if (allDay) {
          rawEnd.setDate(rawEnd.getDate() - 1);
          if (rawEnd < ev.start) rawEnd.setTime(ev.start.getTime());
        }

        allEvents.push({
          id: `${calendar.id}::${sourceEventId}`,
          sourceEventId,
          calendarKey: calendar.id,
          title: ev.summary || '(No title)',
          start: startStr,
          end: formatLocalDate(rawEnd),
          allDay,
          calendarId: calendar.id,
          source: 'ical',
        });
      }
    } catch (err) {
      console.error(`[iCal] Failed to fetch ${calendar.icalUrl}:`, err.message);
    }
  }
  return allEvents;
}

async function refreshCache(state) {
  if (!state || state.calendars.length === 0) {
    if (state) state.cache = { events: [], fetchedAt: Date.now() };
    return;
  }
  try {
    const events = await fetchAll(state.calendars);
    state.cache = { events, fetchedAt: Date.now() };
    state.lastFetchOk = true;
  } catch (err) {
    console.error('[iCal] Cache refresh failed:', err.message);
    state.lastFetchOk = false;
  }
}

module.exports = {
  isConnected() {
    const state = getWorkspaceState();
    return state.calendars.some(calendar => calendar.enabled !== false && calendar.icalUrl);
  },

  async getEvents(start, end) {
    const state = getWorkspaceState();
    const isExpired = !state.cache || (Date.now() - state.cache.fetchedAt) > CACHE_TTL;
    if (isExpired) await refreshCache(state);
    if (!state.cache) return [];
    return state.cache.events.filter(ev => ev.start <= end && ev.end >= start);
  },

  getAuthUrl() {
    return null;
  },

  async handleCallback(_code) {},

  disconnect() {},

  getConfig() {
    return toPublicCalendarConfig('ical', getWorkspaceState().calendars);
  },

  async configure(config) {
    const state = getWorkspaceState();
    state.calendars = normalizeBackendCalendars(config?.calendars, 'ical');
    saveCalendars(state.calendars);
    state.cache = null;
    state.lastFetchOk = false;
    await refreshCache(state);
    return this.getConfig();
  },
};

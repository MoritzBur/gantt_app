const nodeIcal = require('node-ical');
const store = require('../data-store');
const { normalizeBackendCalendars, toPublicCalendarConfig } = require('./shared');

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

let calendars = loadCalendars();
let cache = null;
let lastFetchOk = false;

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

async function fetchAll() {
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

async function refreshCache() {
  if (calendars.length === 0) return;
  try {
    const events = await fetchAll();
    cache = { events, fetchedAt: Date.now() };
    lastFetchOk = true;
  } catch (err) {
    console.error('[iCal] Cache refresh failed:', err.message);
    lastFetchOk = false;
  }
}

if (calendars.length > 0) {
  refreshCache();
}
setInterval(refreshCache, CACHE_TTL);

module.exports = {
  isConnected() {
    return calendars.some(calendar => calendar.enabled !== false && calendar.icalUrl) && lastFetchOk;
  },

  async getEvents(start, end) {
    if (!cache && calendars.length > 0) await refreshCache();
    if (!cache) return [];
    return cache.events.filter(ev => ev.start <= end && ev.end >= start);
  },

  getAuthUrl() {
    return null;
  },

  async handleCallback(_code) {},

  disconnect() {},

  getConfig() {
    return toPublicCalendarConfig('ical', calendars);
  },

  async configure(config) {
    calendars = normalizeBackendCalendars(config?.calendars, 'ical');
    saveCalendars(calendars);
    cache = null;
    lastFetchOk = false;
    await refreshCache();
    return this.getConfig();
  },
};

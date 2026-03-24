const nodeIcal = require('node-ical');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../../data/calendar-config.json');
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

let icalUrls = loadUrls();
let cache = null;
let lastFetchOk = false;

function loadUrls() {
  // Config file takes precedence over env var
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (Array.isArray(config.icalUrls) && config.icalUrls.length > 0) {
        return config.icalUrls;
      }
    }
  } catch (_) {}
  return (process.env.ICAL_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
}

function saveConfig(urls) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ icalUrls: urls }, null, 2), 'utf8');
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
  for (const url of icalUrls) {
    try {
      const data = await nodeIcal.async.fromURL(url);
      for (const [key, ev] of Object.entries(data)) {
        if (ev.type !== 'VEVENT' || !ev.start) continue;

        const allDay = isDateOnly(ev.start);
        const startStr = formatLocalDate(ev.start);

        const rawEnd = ev.end ? new Date(ev.end) : new Date(ev.start);
        if (allDay) {
          rawEnd.setDate(rawEnd.getDate() - 1);
          if (rawEnd < ev.start) rawEnd.setTime(ev.start.getTime());
        }

        allEvents.push({
          id: ev.uid || key,
          title: ev.summary || '(No title)',
          start: startStr,
          end: formatLocalDate(rawEnd),
          allDay,
          source: 'ical',
        });
      }
    } catch (err) {
      console.error(`[iCal] Failed to fetch ${url}:`, err.message);
    }
  }
  return allEvents;
}

async function refreshCache() {
  if (icalUrls.length === 0) return;
  try {
    const events = await fetchAll();
    cache = { events, fetchedAt: Date.now() };
    lastFetchOk = true;
  } catch (err) {
    console.error('[iCal] Cache refresh failed:', err.message);
    lastFetchOk = false;
  }
}

if (icalUrls.length > 0) {
  refreshCache();
}
setInterval(refreshCache, CACHE_TTL);

module.exports = {
  isConnected() {
    return icalUrls.length > 0 && lastFetchOk;
  },

  async getEvents(start, end) {
    if (!cache && icalUrls.length > 0) await refreshCache();
    if (!cache) return [];
    return cache.events.filter(ev => ev.start <= end && ev.end >= start);
  },

  getAuthUrl() {
    return null;
  },

  async handleCallback(_code) {},

  disconnect() {},

  getConfig() {
    return { icalUrls };
  },

  async configure({ icalUrls: newUrls }) {
    icalUrls = newUrls;
    saveConfig(newUrls);
    cache = null;
    lastFetchOk = false;
    await refreshCache();
  },
};

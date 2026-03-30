const { google } = require('googleapis');
const store = require('../data-store');
const { normalizeBackendCalendars, normalizeGoogleCalendar, toPublicCalendarConfig } = require('./shared');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function getRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api/calendar/callback`;
}

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

function loadTokens() {
  try {
    return store.readTokens();
  } catch (err) {
    console.error('[Google] Failed to load tokens:', err);
  }
  return null;
}

function saveTokens(tokens) {
  store.writeTokens(tokens);
}

function getEnvCalendarIds() {
  return (process.env.GOOGLE_CALENDAR_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

function getStoredCalendars() {
  const config = store.readCalendarConfig();
  return normalizeBackendCalendars(config.backends?.google?.calendars, 'google');
}

function buildDerivedCalendars(submittedCalendars = null) {
  const envCalendarIds = getEnvCalendarIds();
  const storedByCalendarId = new Map(getStoredCalendars().map(calendar => [calendar.calendarId, calendar]));
  const submittedByCalendarId = new Map(
    normalizeBackendCalendars(submittedCalendars, 'google').map(calendar => [calendar.calendarId, calendar])
  );

  return envCalendarIds.map((calendarId, index) => {
    const submitted = submittedByCalendarId.get(calendarId);
    const stored = storedByCalendarId.get(calendarId);
    return normalizeGoogleCalendar({
      ...stored,
      ...submitted,
      calendarId,
      enabled: true,
    }, index);
  });
}

function saveCalendars(nextCalendars) {
  const config = store.readCalendarConfig();
  store.writeCalendarConfig({
    ...config,
    backends: {
      ...config.backends,
      google: {
        calendars: normalizeBackendCalendars(nextCalendars, 'google'),
      },
    },
  });
}

module.exports = {
  isConnected() {
    return !!loadTokens();
  },

  getAuthUrl() {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
  },

  async handleCallback(code) {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    saveTokens(tokens);
  },

  disconnect() {
    store.deleteTokens();
  },

  getConfig() {
    return toPublicCalendarConfig('google', buildDerivedCalendars());
  },

  async configure(config) {
    const calendars = buildDerivedCalendars(config?.calendars);
    saveCalendars(calendars);
    return this.getConfig();
  },

  async getEvents(start, end) {
    const tokens = loadTokens();
    if (!tokens) return [];

    const calendars = buildDerivedCalendars();

    if (calendars.length === 0) return [];

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (newTokens) => {
      saveTokens({ ...tokens, ...newTokens });
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const allEvents = [];

    for (const calendarConfig of calendars) {
      const calendarId = calendarConfig.calendarId;
      try {
        const response = await calendar.events.list({
          calendarId,
          timeMin: new Date(start).toISOString(),
          timeMax: new Date(end).toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
        });

        for (const item of (response.data.items || [])) {
          const isAllDay = !!item.start.date;
          const eventStart = item.start.date || item.start.dateTime?.slice(0, 10);
          let eventEnd = item.end.date || item.end.dateTime?.slice(0, 10);
          if (isAllDay && eventEnd) {
            const d = new Date(eventEnd);
            d.setDate(d.getDate() - 1);
            eventEnd = d.toISOString().slice(0, 10);
          }
          allEvents.push({
            id: `${calendarConfig.id}::${item.id}`,
            sourceEventId: item.id,
            calendarKey: calendarConfig.id,
            title: item.summary || '(No title)',
            start: eventStart,
            end: eventEnd,
            allDay: isAllDay,
            calendarId,
            source: 'google',
          });
        }
      } catch (err) {
        console.error(`[Google] Failed to fetch calendar ${calendarId}:`, err.message);
        if (err.code === 401 || err.response?.status === 401) {
          store.deleteTokens();
          throw Object.assign(new Error('Token expired'), { code: 401 });
        }
      }
    }

    return allEvents;
  },
};

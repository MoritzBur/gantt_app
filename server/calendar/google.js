const { google } = require('googleapis');
const store = require('../data-store');

const REDIRECT_URI = 'http://localhost:3000/api/calendar/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
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
    return {};
  },

  async configure(_config) {},

  async getEvents(start, end) {
    const tokens = loadTokens();
    if (!tokens) return [];

    const calendarIds = (process.env.GOOGLE_CALENDAR_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    if (calendarIds.length === 0) return [];

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (newTokens) => {
      saveTokens({ ...tokens, ...newTokens });
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const allEvents = [];

    for (const calendarId of calendarIds) {
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
            id: item.id,
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

const crypto = require('crypto');

const CALENDAR_COLOR_PALETTE = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

const DEFAULT_CALENDAR_STORE = {
  version: 2,
  backends: {
    ical: { calendars: [] },
    google: { calendars: [] },
  },
};

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function normalizeLabel(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function getDefaultCalendarColor(index) {
  return CALENDAR_COLOR_PALETTE[index % CALENDAR_COLOR_PALETTE.length];
}

function stableDigest(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function makeCalendarId(source, identity, index) {
  return `${source}-${stableDigest(identity || `${source}-${index}`)}`;
}

function normalizeIcalCalendar(entry, index) {
  const icalUrl = typeof entry?.icalUrl === 'string' ? entry.icalUrl.trim() : '';
  const icalPath = typeof entry?.icalPath === 'string' ? entry.icalPath.trim() : '';
  const fallbackLabel = `Calendar ${index + 1}`;
  const identity = icalUrl || icalPath;

  return {
    id: normalizeLabel(entry?.id, makeCalendarId('ical', identity, index)),
    source: 'ical',
    label: normalizeLabel(entry?.label, fallbackLabel),
    color: isHexColor(entry?.color) ? entry.color.trim() : getDefaultCalendarColor(index),
    icalUrl,
    icalPath,
    resolvedIcalPath: typeof entry?.resolvedIcalPath === 'string' ? entry.resolvedIcalPath.trim() : '',
    enabled: entry?.enabled !== false,
  };
}

function normalizeGoogleCalendar(entry, index) {
  const calendarId = typeof entry?.calendarId === 'string' ? entry.calendarId.trim() : '';
  const fallbackLabel = calendarId || `Calendar ${index + 1}`;

  return {
    id: normalizeLabel(entry?.id, makeCalendarId('google', calendarId, index)),
    source: 'google',
    label: normalizeLabel(entry?.label, fallbackLabel),
    color: isHexColor(entry?.color) ? entry.color.trim() : getDefaultCalendarColor(index),
    calendarId,
    enabled: entry?.enabled !== false,
  };
}

function normalizeBackendCalendars(calendars, source) {
  if (!Array.isArray(calendars)) return [];

  const normalized = calendars.map((entry, index) => {
    if (source === 'google') return normalizeGoogleCalendar(entry, index);
    return normalizeIcalCalendar(entry, index);
  });

  if (source === 'google') {
    return normalized.filter(calendar => calendar.calendarId);
  }
  return normalized.filter(calendar => calendar.icalUrl || calendar.icalPath);
}

function normalizeCalendarStore(raw) {
  const next = {
    version: 2,
    backends: {
      ical: { calendars: [] },
      google: { calendars: [] },
    },
  };

  if (!raw || typeof raw !== 'object') return next;

  if (raw.version === 2 && raw.backends && typeof raw.backends === 'object') {
    next.backends.ical.calendars = normalizeBackendCalendars(raw.backends.ical?.calendars, 'ical');
    next.backends.google.calendars = normalizeBackendCalendars(raw.backends.google?.calendars, 'google');
    return next;
  }

  if (raw.version === 2 && typeof raw.backend === 'string' && Array.isArray(raw.calendars)) {
    if (raw.backend === 'google') {
      next.backends.google.calendars = normalizeBackendCalendars(raw.calendars, 'google');
    } else {
      next.backends.ical.calendars = normalizeBackendCalendars(raw.calendars, 'ical');
    }
    return next;
  }

  if (Array.isArray(raw.icalUrls)) {
    next.backends.ical.calendars = raw.icalUrls
      .map((icalUrl, index) => normalizeIcalCalendar({ icalUrl }, index))
      .filter(calendar => calendar.icalUrl);
  }

  return next;
}

function toPublicCalendarConfig(backend, calendars) {
  return {
    version: 2,
    backend,
    calendars: backend === 'google'
      ? normalizeBackendCalendars(calendars, 'google')
      : normalizeBackendCalendars(calendars, 'ical'),
  };
}

module.exports = {
  CALENDAR_COLOR_PALETTE,
  DEFAULT_CALENDAR_STORE,
  getDefaultCalendarColor,
  makeCalendarId,
  normalizeIcalCalendar,
  normalizeGoogleCalendar,
  normalizeBackendCalendars,
  normalizeCalendarStore,
  toPublicCalendarConfig,
};

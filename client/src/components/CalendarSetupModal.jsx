import React, { useEffect, useState } from 'react';

const CALENDAR_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

function createDraftIcalCalendar(index) {
  return {
    id: `draft-ical-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'ical',
    label: `Calendar ${index + 1}`,
    color: CALENDAR_COLORS[index % CALENDAR_COLORS.length],
    icalUrl: '',
    icalPath: '',
    resolvedIcalPath: '',
    enabled: true,
  };
}

function sanitizeIcalCalendars(calendars) {
  return calendars
    .map((calendar, index) => ({
      id: calendar.id,
      source: 'ical',
      label: (calendar.label || '').trim() || `Calendar ${index + 1}`,
      color: calendar.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length],
      icalUrl: (calendar.icalUrl || '').trim(),
      icalPath: (calendar.icalPath || '').trim(),
      enabled: calendar.enabled !== false,
    }))
    .filter(calendar => calendar.icalUrl || calendar.icalPath);
}

function sanitizeGoogleCalendars(calendars) {
  return calendars.map((calendar, index) => ({
    id: calendar.id,
    source: 'google',
    label: (calendar.label || '').trim() || calendar.calendarId || `Calendar ${index + 1}`,
    color: calendar.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length],
    calendarId: calendar.calendarId,
    enabled: true,
  }));
}

export default function CalendarSetupModal({ status, config, onSave, onClose }) {
  const [icalCalendars, setIcalCalendars] = useState([]);
  const [googleCalendars, setGoogleCalendars] = useState([]);
  const [saving, setSaving] = useState(null); // 'ical' | 'google' | null
  const [saveResult, setSaveResult] = useState(null); // 'ical-ok' | 'ical-error' | 'google-ok' | 'google-error' | null

  useEffect(() => {
    if (status.backend === 'ical') {
      const nextCalendars = Array.isArray(config?.calendars) && config.calendars.length > 0
        ? config.calendars.map((calendar, index) => ({
            ...calendar,
            label: calendar.label || `Calendar ${index + 1}`,
            color: calendar.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length],
            enabled: calendar.enabled !== false,
          }))
        : [createDraftIcalCalendar(0)];
      setIcalCalendars(nextCalendars);
    }

    if (status.backend === 'google') {
      setGoogleCalendars(Array.isArray(config?.calendars) ? config.calendars : []);
    }
  }, [status.backend, config]);

  const isIcal = status.backend === 'ical';
  const isGoogle = status.backend === 'google';

  const updateIcalCalendar = (calendarId, patch) => {
    setIcalCalendars(prev => prev.map(calendar => (
      calendar.id === calendarId ? { ...calendar, ...patch } : calendar
    )));
    setSaveResult(null);
  };

  const updateGoogleCalendar = (calendarId, patch) => {
    setGoogleCalendars(prev => prev.map(calendar => (
      calendar.id === calendarId ? { ...calendar, ...patch } : calendar
    )));
    setSaveResult(null);
  };

  const handleAddIcalCalendar = () => {
    setIcalCalendars(prev => [...prev, createDraftIcalCalendar(prev.length)]);
    setSaveResult(null);
  };

  const handleRemoveIcalCalendar = (calendarId) => {
    setIcalCalendars(prev => prev.filter(calendar => calendar.id !== calendarId));
    setSaveResult(null);
  };

  const handleSaveIcal = async () => {
    setSaving('ical');
    setSaveResult(null);
    const calendars = sanitizeIcalCalendars(icalCalendars);
    const ok = await onSave({
      version: 2,
      backend: 'ical',
      calendars,
    });
    setSaveResult(ok ? 'ical-ok' : 'ical-error');
    if (ok) {
      setIcalCalendars(calendars.length > 0 ? calendars : [createDraftIcalCalendar(0)]);
    }
    setSaving(null);
  };

  const handleSaveGoogle = async () => {
    setSaving('google');
    setSaveResult(null);
    const ok = await onSave({
      version: 2,
      backend: 'google',
      calendars: sanitizeGoogleCalendars(googleCalendars),
    });
    setSaveResult(ok ? 'google-ok' : 'google-error');
    setSaving(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cal-setup-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Connect Calendar</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body cal-setup-body">
          <div className={`cal-option ${isIcal ? 'cal-option-active' : ''}`}>
            <div className="cal-option-header">
              <span className="cal-option-title">iCal Subscription</span>
              {isIcal && <span className="cal-option-badge">Active</span>}
              <span className="cal-option-tag">Recommended</span>
            </div>
            <p className="cal-option-desc">
              Each saved feed becomes its own calendar group with its own color, order, and collapse state. You can use either a remote subscription URL or a local <code>.ics</code> file.
            </p>

            {isIcal ? (
              <>
                <div className="cal-editor-list">
                  {icalCalendars.map((calendar, index) => (
                    <div key={calendar.id} className="cal-editor-card">
                      <div className="cal-editor-row">
                        <label className="cal-option-label">
                          Label
                          <input
                            className="cal-text-input"
                            value={calendar.label}
                            onChange={e => updateIcalCalendar(calendar.id, { label: e.target.value })}
                            placeholder={`Calendar ${index + 1}`}
                          />
                        </label>
                        <label className="cal-option-label cal-color-field">
                          Color
                          <input
                            className="cal-color-input"
                            type="color"
                            value={calendar.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length]}
                            onChange={e => updateIcalCalendar(calendar.id, { color: e.target.value })}
                          />
                        </label>
                      </div>

                      <label className="cal-option-label">
                        iCal URL
                        <input
                          className="cal-text-input cal-url-input"
                          value={calendar.icalUrl || ''}
                          onChange={e => updateIcalCalendar(calendar.id, { icalUrl: e.target.value })}
                          placeholder="https://calendar.google.com/calendar/ical/you%40gmail.com/private-xxx/basic.ics"
                          spellCheck={false}
                        />
                      </label>

                      <label className="cal-option-label">
                        Local <code>.ics</code> file
                        <input
                          className="cal-text-input cal-url-input"
                          value={calendar.icalPath || ''}
                          onChange={e => updateIcalCalendar(calendar.id, { icalPath: e.target.value })}
                          placeholder="$workspace/calendars/personal.ics or /Users/you/Calendars/personal.ics"
                          spellCheck={false}
                        />
                      </label>

                      {calendar.resolvedIcalPath ? (
                        <label className="cal-option-label">
                          Resolved local path
                          <input
                            className="cal-text-input cal-readonly-input"
                            value={calendar.resolvedIcalPath}
                            readOnly
                            spellCheck={false}
                          />
                        </label>
                      ) : null}

                      <div className="cal-editor-actions">
                        <span className="cal-option-hint">
                          Demo workspaces use <code>$workspace/...</code> so the shipped calendars stay portable across install locations.
                        </span>
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={() => handleRemoveIcalCalendar(calendar.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="cal-option-actions cal-option-actions-stacked">
                  <button className="btn btn-ghost" onClick={handleAddIcalCalendar} type="button">
                    + Add calendar
                  </button>
                  <div className="cal-option-save-row">
                    <button
                      className="btn btn-primary"
                      onClick={handleSaveIcal}
                      disabled={saving === 'ical'}
                    >
                      {saving === 'ical' ? 'Saving…' : 'Save iCal calendars'}
                    </button>
                    {saveResult === 'ical-ok' && <span className="cal-save-ok">Saved ✓</span>}
                    {saveResult === 'ical-error' && <span className="cal-save-error">Save failed ✗</span>}
                  </div>
                </div>
              </>
            ) : (
              <p className="cal-option-hint">
                Switch to this backend by setting <code>CALENDAR_BACKEND=ical</code> in <code>.env</code> and restarting.
              </p>
            )}
          </div>

          <div className="cal-option-divider">or</div>

          <div className={`cal-option ${isGoogle ? 'cal-option-active' : ''}`}>
            <div className="cal-option-header">
              <span className="cal-option-title">Google Calendar API</span>
              {isGoogle && <span className="cal-option-badge">Active</span>}
            </div>
            <p className="cal-option-desc">
              Uses OAuth and <code>GOOGLE_CALENDAR_IDS</code>. In v1, membership is still controlled in <code>.env</code>; the app lets you label and color each configured Google calendar.
            </p>
            {isGoogle ? (
              status.connected ? (
                googleCalendars.length > 0 ? (
                  <>
                    <div className="cal-editor-list">
                      {googleCalendars.map((calendar, index) => (
                        <div key={calendar.id} className="cal-editor-card">
                          <div className="cal-editor-row">
                            <label className="cal-option-label">
                              Label
                              <input
                                className="cal-text-input"
                                value={calendar.label || ''}
                                onChange={e => updateGoogleCalendar(calendar.id, { label: e.target.value })}
                                placeholder={calendar.calendarId || `Calendar ${index + 1}`}
                              />
                            </label>
                            <label className="cal-option-label cal-color-field">
                              Color
                              <input
                                className="cal-color-input"
                                type="color"
                                value={calendar.color || CALENDAR_COLORS[index % CALENDAR_COLORS.length]}
                                onChange={e => updateGoogleCalendar(calendar.id, { color: e.target.value })}
                              />
                            </label>
                          </div>

                          <label className="cal-option-label">
                            Calendar ID
                            <input
                              className="cal-text-input cal-readonly-input"
                              value={calendar.calendarId || ''}
                              readOnly
                              spellCheck={false}
                            />
                          </label>
                        </div>
                      ))}
                    </div>

                    <div className="cal-option-actions">
                      <button
                        className="btn btn-primary"
                        onClick={handleSaveGoogle}
                        disabled={saving === 'google'}
                      >
                        {saving === 'google' ? 'Saving…' : 'Save Google metadata'}
                      </button>
                      {saveResult === 'google-ok' && <span className="cal-save-ok">Saved ✓</span>}
                      {saveResult === 'google-error' && <span className="cal-save-error">Save failed ✗</span>}
                    </div>
                  </>
                ) : (
                  <p className="cal-option-hint">
                    Add one or more comma-separated ids to <code>GOOGLE_CALENDAR_IDS</code> in <code>.env</code>, then restart the app.
                  </p>
                )
              ) : status.authUrl ? (
                <a href={status.authUrl} className="btn btn-primary">
                  Connect with Google
                </a>
              ) : (
                <p className="cal-option-hint">
                  Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code> first.
                </p>
              )
            ) : (
              <p className="cal-option-hint">
                Switch to this backend by setting <code>CALENDAR_BACKEND=google</code> in <code>.env</code> and restarting.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

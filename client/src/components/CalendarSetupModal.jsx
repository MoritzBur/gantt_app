import React, { useState } from 'react';

export default function CalendarSetupModal({ status, config, onSave, onClose }) {
  const [icalInput, setIcalInput] = useState(
    (config?.icalUrls || []).join('\n')
  );
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // 'ok' | 'error'

  const handleSaveIcal = async () => {
    setSaving(true);
    setSaveResult(null);
    const urls = icalInput.split('\n').map(u => u.trim()).filter(Boolean);
    const ok = await onSave({ icalUrls: urls });
    setSaveResult(ok ? 'ok' : 'error');
    setSaving(false);
  };

  const isIcal = status.backend === 'ical';
  const isGoogle = status.backend === 'google';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cal-setup-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Connect Calendar</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body cal-setup-body">
          {/* iCal option */}
          <div className={`cal-option ${isIcal ? 'cal-option-active' : ''}`}>
            <div className="cal-option-header">
              <span className="cal-option-title">iCal Subscription</span>
              {isIcal && <span className="cal-option-badge">Active</span>}
              <span className="cal-option-tag">Recommended</span>
            </div>
            <p className="cal-option-desc">
              No Google Cloud project needed. Works with Google Calendar, Apple Calendar, Outlook, and more.
            </p>
            <label className="cal-option-label">
              iCal URL(s) — one per line
            </label>
            <textarea
              className="cal-ical-input"
              value={icalInput}
              onChange={e => { setIcalInput(e.target.value); setSaveResult(null); }}
              placeholder={'https://calendar.google.com/calendar/ical/you%40gmail.com/private-xxx/basic.ics'}
              rows={4}
              spellCheck={false}
            />
            <p className="cal-option-hint">
              Find it in Google Calendar → Settings → your calendar → <em>"Secret address in iCal format"</em>
            </p>
            <div className="cal-option-actions">
              <button
                className="btn btn-primary"
                onClick={handleSaveIcal}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saveResult === 'ok' && <span className="cal-save-ok">Saved ✓</span>}
              {saveResult === 'error' && <span className="cal-save-error">Save failed ✗</span>}
            </div>
          </div>

          <div className="cal-option-divider">or</div>

          {/* Google API option */}
          <div className={`cal-option ${isGoogle ? 'cal-option-active' : ''}`}>
            <div className="cal-option-header">
              <span className="cal-option-title">Google Calendar API</span>
              {isGoogle && <span className="cal-option-badge">Active</span>}
            </div>
            <p className="cal-option-desc">
              Uses OAuth — requires a Google Cloud project. Set <code>CALENDAR_BACKEND=google</code> in <code>.env</code> to activate.
            </p>
            {isGoogle ? (
              status.connected ? (
                <span className="cal-connected-label">Connected ✓</span>
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

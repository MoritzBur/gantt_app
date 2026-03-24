import React from 'react';

/**
 * CalendarOverlay renders a status/info panel for the Google Calendar integration.
 * The actual event rendering is handled inside GanttView's row logic.
 * This component is used for displaying connection state and event details if needed.
 */
export default function CalendarOverlay({ connected, events, onDisconnect }) {
  if (!connected) {
    return (
      <div className="calendar-overlay-panel not-connected">
        <p className="cal-info-text">
          Connect your Google Calendar to see events alongside your tasks.
        </p>
        <a href="/api/calendar/auth" className="btn btn-secondary">
          Connect Google Calendar →
        </a>
      </div>
    );
  }

  return (
    <div className="calendar-overlay-panel connected">
      <div className="cal-info-row">
        <span className="cal-connected-badge">● Connected</span>
        <span className="cal-event-count muted">
          {events.length} event{events.length !== 1 ? 's' : ''} loaded
        </span>
        <button className="btn btn-ghost btn-small" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    </div>
  );
}

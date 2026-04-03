import React, { useEffect, useMemo, useRef } from 'react';
import {
  getActiveBlockerScenario,
  getSavedCalendarEventIds,
  getSelectedMemberIds,
} from '../utils/resourcePlanning.js';

function SectionTitle({ children }) {
  return <div className="blocker-menu-section-title">{children}</div>;
}

export default function BlockerFilterMenu({
  personnel,
  calendarEvents,
  blockerScenarioState,
  onChange,
  onClose,
  position,
}) {
  const menuRef = useRef(null);
  const activeScenario = useMemo(
    () => getActiveBlockerScenario(blockerScenarioState),
    [blockerScenarioState]
  );
  const savedCalendarEventIds = useMemo(
    () => new Set(getSavedCalendarEventIds(calendarEvents, blockerScenarioState)),
    [calendarEvents, blockerScenarioState]
  );
  const selectedMemberIds = useMemo(
    () => new Set(getSelectedMemberIds(personnel, blockerScenarioState)),
    [personnel, blockerScenarioState]
  );
  const calendars = useMemo(() => {
    const map = new Map();
    for (const event of calendarEvents || []) {
      if (!event.calendarKey) continue;
      if (!map.has(event.calendarKey)) {
        map.set(event.calendarKey, {
          id: event.calendarKey,
          name: event.calendarLabel || event.calendarName || event.calendarKey,
          color: event.color || '#4A90D9',
          eventIds: [],
        });
      }
      map.get(event.calendarKey).eventIds.push(event.id);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [calendarEvents]);
  const teams = useMemo(
    () => [...(personnel?.teams || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [personnel]
  );
  const visibleCalendarIds = useMemo(
    () => new Set(activeScenario?.calendars?.visibleCalendarIds || []),
    [activeScenario]
  );
  const calendarsFilterInitialized = activeScenario?.calendars?.filterInitialized === true;
  const allCalendarsVisible = calendars.length > 0 && (
    !calendarsFilterInitialized || visibleCalendarIds.size === calendars.length
  );

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose?.();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const updateScenario = (updater) => {
    const nextScenario = updater(activeScenario);
    onChange({
      ...blockerScenarioState,
      scenarios: (blockerScenarioState?.scenarios || []).map((scenario) => (
        scenario.id === activeScenario.id ? nextScenario : scenario
      )),
    });
  };

  const toggleAllCalendars = () => {
    updateScenario((scenario) => {
      const allCalendarIds = calendars.map((calendar) => calendar.id);
      const currentFilterInitialized = scenario.calendars?.filterInitialized === true;
      const currentVisibleIds = scenario.calendars?.visibleCalendarIds || [];
      const allCurrentlyVisible = !currentFilterInitialized || currentVisibleIds.length === allCalendarIds.length;
      const nextVisibleCalendarIds = allCurrentlyVisible
        ? []
        : allCalendarIds;
      return {
        ...scenario,
        calendars: {
          ...scenario.calendars,
          filterInitialized: true,
          visibleCalendarIds: nextVisibleCalendarIds,
        },
      };
    });
  };

  const toggleCalendar = (calendarId) => {
    updateScenario((scenario) => {
      const current = new Set(
        scenario.calendars?.filterInitialized === true
          ? (scenario.calendars?.visibleCalendarIds || [])
          : calendars.map((calendar) => calendar.id)
      );
      if (current.has(calendarId)) current.delete(calendarId);
      else current.add(calendarId);
      return {
        ...scenario,
        calendars: {
          ...scenario.calendars,
          filterInitialized: true,
          visibleCalendarIds: [...current],
        },
      };
    });
  };

  const toggleTeam = (teamId) => {
    updateScenario((scenario) => {
      const current = new Set(scenario.resources?.teamIds || []);
      if (current.has(teamId)) current.delete(teamId);
      else current.add(teamId);
      return {
        ...scenario,
        resources: {
          ...scenario.resources,
          teamIds: [...current],
        },
      };
    });
  };

  const toggleMember = (memberId) => {
    updateScenario((scenario) => {
      const current = new Set(scenario.resources?.memberIds || []);
      if (current.has(memberId)) current.delete(memberId);
      else current.add(memberId);
      return {
        ...scenario,
        resources: {
          ...scenario.resources,
          memberIds: [...current],
        },
      };
    });
  };

  return (
    <div
      ref={menuRef}
      className="blocker-filter-menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="assignment-picker-header">
        <span>Blockers</span>
        <button type="button" className="assignment-picker-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <SectionTitle>Calendars</SectionTitle>
      <label className="blocker-menu-option blocker-menu-option-root">
        <input
          type="checkbox"
          checked={allCalendarsVisible}
          onChange={toggleAllCalendars}
        />
        <span>All calendars</span>
      </label>
      {calendars.map((calendar) => (
        <label key={calendar.id} className="blocker-menu-option blocker-menu-option-child blocker-menu-option-static">
          <input
            type="checkbox"
            checked={!calendarsFilterInitialized || visibleCalendarIds.has(calendar.id)}
            onChange={() => toggleCalendar(calendar.id)}
          />
          <span className="blocker-menu-color" style={{ backgroundColor: calendar.color }} />
          <span>{calendar.name}</span>
          <span className="blocker-menu-meta">
            {(calendar.eventIds || []).filter((eventId) => savedCalendarEventIds.has(eventId)).length}
          </span>
        </label>
      ))}

      <SectionTitle>People</SectionTitle>
      {teams.map((team) => {
        const teamMembers = (personnel?.members || [])
          .filter((member) => (member.teamIds || []).includes(team.id))
          .sort((a, b) => a.name.localeCompare(b.name));
        const teamChecked = (activeScenario?.resources?.teamIds || []).includes(team.id);
        return (
          <div key={team.id} className="blocker-menu-team-group">
            <label className="blocker-menu-option blocker-menu-option-root">
              <input
                type="checkbox"
                checked={teamChecked}
                onChange={() => toggleTeam(team.id)}
              />
              <span>{team.name}</span>
            </label>
            {teamMembers.map((member) => (
              <label key={member.id} className="blocker-menu-option blocker-menu-option-child">
                <input
                  type="checkbox"
                  checked={selectedMemberIds.has(member.id)}
                  onChange={() => toggleMember(member.id)}
                />
                <span>{member.name}</span>
              </label>
            ))}
          </div>
        );
      })}

      {(personnel?.members || []).filter((member) => (member.teamIds || []).length === 0).length > 0 && (
        <>
          <SectionTitle>Unassigned</SectionTitle>
          {(personnel?.members || [])
            .filter((member) => (member.teamIds || []).length === 0)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((member) => (
              <label key={member.id} className="blocker-menu-option blocker-menu-option-root">
                <input
                  type="checkbox"
                  checked={selectedMemberIds.has(member.id)}
                  onChange={() => toggleMember(member.id)}
                />
                <span>{member.name}</span>
              </label>
            ))}
        </>
      )}
    </div>
  );
}

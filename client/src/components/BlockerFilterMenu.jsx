import React, { useEffect, useMemo, useRef } from 'react';
import {
  getActiveBlockerScenario,
  getAssetTypeForGroup,
  getAssetTypeForMember,
  getAssetTypeMap,
  getDefaultAssetType,
  getSavedCalendarEventIds,
  getSelectedMemberIds,
  getTeamMap,
  groupPersonnelByType,
  rgbaFromHex,
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
  const assetTypeMap = useMemo(() => getAssetTypeMap(personnel), [personnel]);
  const fallbackAssetType = useMemo(() => getDefaultAssetType(personnel), [personnel]);
  const teamMap = useMemo(() => getTeamMap(personnel), [personnel]);
  const savedCalendarEventIds = useMemo(
    () => new Set(getSavedCalendarEventIds(calendarEvents, blockerScenarioState)),
    [calendarEvents, blockerScenarioState]
  );
  const selectedMemberIds = useMemo(
    () => new Set(getSelectedMemberIds(personnel, blockerScenarioState)),
    [personnel, blockerScenarioState]
  );
  const selectedTeamIds = useMemo(
    () => new Set(activeScenario?.resources?.teamIds || []),
    [activeScenario]
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
  const groupedTypes = useMemo(() => {
    const baseGroups = groupPersonnelByType(personnel);
    return baseGroups.map(({ type, teams, members }) => {
      const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name));
      const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name));
      const ungroupedMembers = sortedMembers.filter((member) => (member.teamIds || []).length === 0);
      return {
        type,
        teams: sortedTeams,
        members: sortedMembers,
        ungroupedMembers,
      };
    }).filter(({ teams, members }) => teams.length > 0 || members.length > 0);
  }, [personnel]);
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
      <p className="blocker-menu-helper">
        Select calendars, groups, or assets to overlay tasks that are marked as blockers.
      </p>

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

      <SectionTitle>Assets</SectionTitle>
      {groupedTypes.length === 0 && (
        <div className="assignment-picker-empty">Create an asset type, group, or asset to use task blockers.</div>
      )}
      {groupedTypes.map(({ type, teams, ungroupedMembers }) => (
        <div key={type.id} className="blocker-menu-type-section">
          <div
            className="blocker-menu-type-header"
            style={{
              backgroundColor: rgbaFromHex(type.color, 0.12),
              borderColor: rgbaFromHex(type.color, 0.28),
            }}
          >
            <span className="blocker-menu-color" style={{ backgroundColor: type.color }} />
            <span>{type.name}</span>
          </div>

          {teams.length > 0 && (
            <>
              <div className="blocker-menu-subtitle">{type.groupLabelPlural}</div>
              {teams.map((team) => {
                const teamType = getAssetTypeForGroup(team, assetTypeMap, fallbackAssetType);
                const teamMembers = (personnel?.members || [])
                  .filter((member) => (member.teamIds || []).includes(team.id))
                  .sort((a, b) => a.name.localeCompare(b.name));
                return (
                  <div key={team.id} className="blocker-menu-team-group">
                    <label className="blocker-menu-option blocker-menu-option-root">
                      <input
                        type="checkbox"
                        checked={selectedTeamIds.has(team.id)}
                        onChange={() => toggleTeam(team.id)}
                      />
                      <span className="blocker-menu-color" style={{ backgroundColor: teamType.color }} />
                      <span>{team.name}</span>
                    </label>
                    {teamMembers.map((member) => {
                      const memberType = getAssetTypeForMember(member, assetTypeMap, fallbackAssetType);
                      return (
                        <label key={member.id} className="blocker-menu-option blocker-menu-option-child">
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.has(member.id)}
                            onChange={() => toggleMember(member.id)}
                          />
                          <span className="blocker-menu-color" style={{ backgroundColor: memberType.color }} />
                          <span>{member.name}</span>
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}

          {ungroupedMembers.length > 0 && (
            <>
              <div className="blocker-menu-subtitle">Ungrouped {type.assetLabelPlural}</div>
              {ungroupedMembers.map((member) => {
                const memberType = getAssetTypeForMember(member, assetTypeMap, fallbackAssetType);
                return (
                  <label key={member.id} className="blocker-menu-option blocker-menu-option-root">
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.has(member.id)}
                      onChange={() => toggleMember(member.id)}
                    />
                    <span className="blocker-menu-color" style={{ backgroundColor: memberType.color }} />
                    <span>{member.name}</span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

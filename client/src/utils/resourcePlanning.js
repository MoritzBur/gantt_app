export function parseDate(str) {
  const [y, m, d] = String(str || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

export function diffDays(a, b) {
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export function enumerateDateStrings(startStr, endStr) {
  if (!startStr || !endStr) return [];
  const dates = [];
  let cursor = parseDate(startStr);
  const end = parseDate(endStr);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function collectTaskNodes(items, acc = []) {
  for (const item of items || []) {
    if (item.type === 'task') acc.push(item);
    if (item.children?.length) collectTaskNodes(item.children, acc);
  }
  return acc;
}

export function getMemberMap(personnel) {
  return new Map((personnel?.members || []).map((member) => [member.id, member]));
}

export function getTeamMap(personnel) {
  return new Map((personnel?.teams || []).map((team) => [team.id, team]));
}

export function getTeamNamesForMember(member, teamMap) {
  return (member?.teamIds || [])
    .map((teamId) => teamMap.get(teamId)?.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function getDefaultBlockerScenarioState() {
  return {
    version: 1,
    activeScenarioId: 'default',
    scenarios: [{
      id: 'default',
      name: 'Default',
      calendars: {
        visible: false,
        filterInitialized: false,
        visibleCalendarIds: [],
        activeEventIds: [],
      },
      resources: {
        teamIds: [],
        memberIds: [],
      },
    }],
  };
}

export function getActiveBlockerScenario(blockerScenarioState) {
  const state = blockerScenarioState || getDefaultBlockerScenarioState();
  const scenarios = Array.isArray(state.scenarios) && state.scenarios.length > 0
    ? state.scenarios
    : getDefaultBlockerScenarioState().scenarios;
  return scenarios.find((scenario) => scenario.id === state.activeScenarioId) || scenarios[0];
}

export function getVisibleCalendarIds(calendarEvents, blockerScenarioState) {
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  const allCalendarIds = [...new Set((calendarEvents || []).map((event) => event.calendarKey).filter(Boolean))];
  if (activeScenario?.calendars?.filterInitialized !== true) {
    return allCalendarIds;
  }
  return (activeScenario?.calendars?.visibleCalendarIds || []).filter((id) => allCalendarIds.includes(id));
}

export function getSelectedCalendarEventIds(calendarEvents, blockerScenarioState) {
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  const allEventIds = [...new Set((calendarEvents || []).map((event) => event.id).filter(Boolean))];
  const visibleCalendarIds = new Set(getVisibleCalendarIds(calendarEvents, blockerScenarioState));
  return (activeScenario?.calendars?.activeEventIds || []).filter((id) => {
    if (!allEventIds.includes(id)) return false;
    if (visibleCalendarIds.size === 0) return false;
    const event = (calendarEvents || []).find((entry) => entry.id === id);
    return !!event && visibleCalendarIds.has(event.calendarKey);
  });
}

export function getSavedCalendarEventIds(calendarEvents, blockerScenarioState) {
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  const allEventIds = [...new Set((calendarEvents || []).map((event) => event.id).filter(Boolean))];
  return (activeScenario?.calendars?.activeEventIds || []).filter((id) => allEventIds.includes(id));
}

export function getSelectedMemberIds(personnel, blockerScenarioState) {
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  const directMemberIds = new Set(activeScenario?.resources?.memberIds || []);
  const teamIds = new Set(activeScenario?.resources?.teamIds || []);
  for (const member of personnel?.members || []) {
    if ((member.teamIds || []).some((teamId) => teamIds.has(teamId))) {
      directMemberIds.add(member.id);
    }
  }
  return [...directMemberIds];
}

export function getBlockerSelectionSummary(personnel, calendarEvents, blockerScenarioState) {
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  const savedCalendarEventIds = getSavedCalendarEventIds(calendarEvents, blockerScenarioState);
  const selectedMemberIds = getSelectedMemberIds(personnel, blockerScenarioState);
  const selectedTeamIds = activeScenario?.resources?.teamIds || [];
  const parts = [];
  if (savedCalendarEventIds.length > 0) {
    parts.push(`${savedCalendarEventIds.length} cal events`);
  }
  if (selectedTeamIds.length > 0) parts.push(`${selectedTeamIds.length} team`);
  if (selectedMemberIds.length > 0) parts.push(`${selectedMemberIds.length} people`);
  return parts.length > 0 ? parts.join(' • ') : 'No blockers';
}

export function buildBlockerSegments(items, memberIds, options = {}) {
  const memberIdSet = new Set(memberIds || []);
  const excludeTaskId = options.excludeTaskId || null;
  return collectTaskNodes(items).filter((task) => (
    task.blocker &&
    task.assigneeId &&
    memberIdSet.has(task.assigneeId) &&
    task.id !== excludeTaskId &&
    task.start &&
    (task.end || task.start)
  ));
}

export function buildOccupancyByDate(items, memberIds, options = {}) {
  const occupancy = new Map();
  const members = [...new Set(memberIds || [])];
  if (members.length === 0) return occupancy;

  for (const task of buildBlockerSegments(items, members, options)) {
    for (const date of enumerateDateStrings(task.start, task.end || task.start)) {
      const current = occupancy.get(date) || 0;
      occupancy.set(date, current + 1);
    }
  }
  return occupancy;
}

export function calculateAvailability(task, items, personnel, memberId) {
  const start = task?.start;
  const end = task?.milestone ? task?.start : (task?.end || task?.start);
  if (!start || !end || !memberId) {
    return { totalDays: 0, blockedDays: 0, freeDays: 0, availabilityRatio: 0 };
  }

  const occupancy = buildOccupancyByDate(items, [memberId], { excludeTaskId: task?.id });
  const taskDates = enumerateDateStrings(start, end);
  const totalDays = taskDates.length;
  const blockedDays = taskDates.filter((date) => occupancy.get(date) > 0).length;
  const freeDays = Math.max(totalDays - blockedDays, 0);
  return {
    totalDays,
    blockedDays,
    freeDays,
    availabilityRatio: totalDays > 0 ? freeDays / totalDays : 0,
  };
}

export function buildAssignmentOptions(task, items, personnel) {
  const teamMap = getTeamMap(personnel);

  return (personnel?.members || [])
    .map((member) => {
      const availability = calculateAvailability(task, items, personnel, member.id);
      const teamNames = getTeamNamesForMember(member, teamMap);
      return {
        id: member.id,
        name: member.name,
        comment: member.comment || '',
        teamNames,
        sortGroup: teamNames[0] || '~',
        availability,
      };
    })
    .sort((a, b) => (
      a.sortGroup.localeCompare(b.sortGroup) ||
      a.name.localeCompare(b.name)
    ));
}

export function getBlockerSelectionLabel(personnel, calendarEvents, blockerScenarioState) {
  const summary = getBlockerSelectionSummary(personnel, calendarEvents, blockerScenarioState);
  const activeScenario = getActiveBlockerScenario(blockerScenarioState);
  return activeScenario?.name ? `${activeScenario.name}: ${summary}` : summary;
}

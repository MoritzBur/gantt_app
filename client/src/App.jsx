import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import GanttView from './components/GanttView.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import CalendarSetupModal from './components/CalendarSetupModal.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';

const PHASE_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

const CALENDAR_PAST_BUFFER_DAYS = 30;
const CALENDAR_FUTURE_BUFFER_DAYS = 180;

// Compute start/end bounds from a phase's tasks (includes milestones)
function calcPhaseBounds(tasks) {
  const datable = tasks.filter(t => t.start);
  if (datable.length === 0) return null;
  return {
    start: datable.reduce((m, t) => t.start < m ? t.start : m, datable[0].start),
    end: datable.reduce((m, t) => {
      const e = t.end || t.start; // milestones have end === start
      return e > m ? e : m;
    }, datable[0].end || datable[0].start),
  };
}

export default function App() {
  const [data, setData] = useState(null);
  const [uiState, setUiState] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState({ connected: false });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarNotice, setCalendarNotice] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'failed'
  const [saveTimer, setSaveTimer] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // { type: 'task'|'phase', id }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [calendarConfig, setCalendarConfig] = useState(null);

  // Git status
  const [gitStatus, setGitStatus] = useState({
    loaded: false,
    available: false,
    repo: false,
    dirty: false,
    message: null,
  });
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Historical snapshot — { data, hash, date, message } or null
  const [historicalSnapshot, setHistoricalSnapshot] = useState(null);

  // PDF export
  const [exporting, setExporting] = useState(false);
  const uiStateSaveTimerRef = useRef(null);
  const serverRestartNotice = 'The browser UI is newer than the local server process. Restart the app/server so the multi-calendar API loads, then open Connect Calendar and save again.';

  const normalizeUiState = useCallback((raw = {}) => {
    const zoom = typeof raw.zoom === 'string' ? raw.zoom : 'Month';
    const density = raw.density === 'Compact' ? 'Compact' : 'Regular';
    const collapsed = raw.collapsed && typeof raw.collapsed === 'object' && !Array.isArray(raw.collapsed)
      ? raw.collapsed
      : {};
    const calendarCollapsed = raw.calendarCollapsed && typeof raw.calendarCollapsed === 'object' && !Array.isArray(raw.calendarCollapsed)
      ? raw.calendarCollapsed
      : {};
    const calendarOrder = Array.isArray(raw.calendarOrder)
      ? raw.calendarOrder.filter(id => typeof id === 'string' && id.trim())
      : [];
    const activeCalEvents = Array.isArray(raw.activeCalEvents) ? raw.activeCalEvents : [];
    const listWidth = Number.isFinite(raw.listWidth) ? raw.listWidth : 260;

    return {
      zoom,
      density,
      collapsed,
      calendarCollapsed,
      calendarOrder,
      activeCalEvents,
      calendarEventIdsVersion: 2,
      listWidth,
    };
  }, []);

  const normalizeCalendarConfig = useCallback((raw, backendHint = 'ical') => {
    if (raw && raw.version === 2 && Array.isArray(raw.calendars)) {
      return raw;
    }

    if (raw && Array.isArray(raw.icalUrls)) {
      return {
        version: 2,
        backend: backendHint,
        calendars: raw.icalUrls
          .filter(url => typeof url === 'string' && url.trim())
          .map((icalUrl, index) => ({
            id: `legacy-ical-${index}`,
            source: 'ical',
            label: `Calendar ${index + 1}`,
            color: PHASE_COLORS[index % PHASE_COLORS.length],
            icalUrl: icalUrl.trim(),
            enabled: true,
          })),
      };
    }

    return null;
  }, []);

  const readLegacyUiState = useCallback(() => {
    try {
      const zoom = localStorage.getItem('gantt-zoom') || 'Month';
      const density = localStorage.getItem('gantt-density') === 'Compact' ? 'Compact' : 'Regular';
      const collapsed = JSON.parse(localStorage.getItem('gantt-collapsed') || '{}');
      const legacyActiveCalEvents = JSON.parse(localStorage.getItem('gantt-active-cal-events') || '[]');
      const listWidth = parseInt(localStorage.getItem('gantt-list-width') || '260', 10);
      return {
        state: normalizeUiState({
          zoom,
          density,
          collapsed: collapsed && typeof collapsed === 'object' ? collapsed : {},
          activeCalEvents: [],
          listWidth: Number.isFinite(listWidth) ? listWidth : 260,
        }),
        hadLegacyActiveCalEvents: Array.isArray(legacyActiveCalEvents) && legacyActiveCalEvents.length > 0,
      };
    } catch {
      return {
        state: normalizeUiState(),
        hadLegacyActiveCalEvents: false,
      };
    }
  }, [normalizeUiState]);

  // Load tasks on mount — retry a few times to handle the Express startup race
  useEffect(() => {
    const load = async (attempt = 0) => {
      try {
        const [tasksRes, stateRes] = await Promise.all([
          fetch('/api/tasks'),
          fetch('/api/state'),
        ]);
        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);
        const d = await tasksRes.json();
        const serverState = stateRes.ok ? await stateRes.json() : null;
        const legacyState = readLegacyUiState();
        const shouldMigrateLegacy = !serverState?._exists;
        const shouldClearLegacyServerActiveEvents = !!serverState?._legacyCalendarEventIds;
        const needsCalendarStateMigration = !!serverState?._calendarStateNeedsMigration;
        const nextUiState = shouldMigrateLegacy
          ? legacyState.state
          : normalizeUiState({
              ...serverState,
              activeCalEvents: shouldClearLegacyServerActiveEvents ? [] : serverState.activeCalEvents,
            });
        setData(d);
        setUiState(nextUiState);
        setLoading(false);
        if (shouldMigrateLegacy && legacyState.hadLegacyActiveCalEvents) {
          setCalendarNotice('Previously activated calendar blockers were cleared once during migration to grouped calendars because old event ids cannot be mapped safely.');
        } else if (shouldClearLegacyServerActiveEvents) {
          setCalendarNotice('Previously activated calendar blockers were cleared once during migration to grouped calendars because old event ids cannot be mapped safely.');
        }
        if (shouldMigrateLegacy || needsCalendarStateMigration) {
          fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextUiState),
          }).catch(() => {});
        }
      } catch (err) {
        if (attempt < 4) {
          setTimeout(() => load(attempt + 1), 500 * (attempt + 1));
        } else {
          setError('Failed to load tasks: ' + err.message);
          setLoading(false);
        }
      }
    };
    load();
  }, [readLegacyUiState]);

  // Load calendar status and config on mount
  useEffect(() => {
    fetch('/api/calendar/status')
      .then(r => r.json())
      .then(s => setCalendarStatus(s))
      .catch(() => {});
    fetch('/api/calendar/config')
      .then(r => r.json())
      .then(c => {
        const normalized = normalizeCalendarConfig(c, c?.backend || calendarStatus.backend || 'ical');
        if (normalized) {
          setCalendarConfig(normalized);
          if (c.version !== 2) setCalendarNotice(serverRestartNotice);
          return;
        }
        if (c && typeof c === 'object') {
          setCalendarNotice(serverRestartNotice);
        }
      })
      .catch(() => {});
  }, [normalizeCalendarConfig, calendarStatus.backend, serverRestartNotice]);

  // Poll git status every 30s
  const refreshGitStatus = useCallback(() => {
    fetch('/api/git/status')
      .then(r => r.json())
      .then(s => setGitStatus({
        loaded: true,
        available: !!s.available,
        repo: !!s.repo,
        dirty: !!s.dirty,
        message: s.message || null,
      }))
      .catch(() => {
        setGitStatus(prev => ({
          ...prev,
          loaded: true,
          message: 'Snapshot status is temporarily unavailable.',
        }));
      });
  }, []);

  useEffect(() => {
    refreshGitStatus();
    const interval = setInterval(refreshGitStatus, 30000);
    return () => clearInterval(interval);
  }, [refreshGitStatus]);

  // Compute the calendar date range as a string
  const calendarDateRange = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const allDates = data?.phases?.flatMap(p => [p.start, p.end]).filter(Boolean).sort() || [];
    const start = allDates.length > 0 ? new Date(allDates[0]) : new Date(today);
    const end = allDates.length > 0 ? new Date(allDates[allDates.length - 1]) : new Date(today);

    start.setDate(start.getDate() - CALENDAR_PAST_BUFFER_DAYS);
    end.setDate(end.getDate() + CALENDAR_FUTURE_BUFFER_DAYS);

    const minimumFutureEnd = new Date(today);
    minimumFutureEnd.setDate(minimumFutureEnd.getDate() + CALENDAR_FUTURE_BUFFER_DAYS);
    const effectiveEnd = end > minimumFutureEnd ? end : minimumFutureEnd;

    return `${start.toISOString().slice(0, 10)}/${effectiveEnd.toISOString().slice(0, 10)}`;
  }, [data]);

  // Fetch calendar events when connection status or task date range changes
  useEffect(() => {
    if (!calendarStatus.connected || !calendarDateRange) return;
    const [startStr, endStr] = calendarDateRange.split('/');
    fetch(`/api/calendar/events?start=${startStr}&end=${endStr}`)
      .then(r => r.json())
      .then(events => {
        if (Array.isArray(events)) setCalendarEvents(events);
      })
      .catch(() => {});
  }, [calendarStatus.connected, calendarDateRange, calendarConfig]);

  const showSaveStatus = useCallback((status) => {
    setSaveStatus(status);
    if (saveTimer) clearTimeout(saveTimer);
    const timer = setTimeout(() => setSaveStatus(null), 1500);
    setSaveTimer(timer);
    // Refresh git status after any save
    setTimeout(refreshGitStatus, 500);
  }, [saveTimer, refreshGitStatus]);

  const handleAddPhase = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const colorIdx = data ? data.phases.length % PHASE_COLORS.length : 0;
    try {
      const res = await fetch('/api/tasks/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Phase',
          color: PHASE_COLORS[colorIdx],
          start: today,
          end: nextMonth,
        }),
      });
      if (!res.ok) throw new Error('Server error');
      const newPhase = await res.json();
      setData(prev => ({ ...prev, phases: [...prev.phases, newPhase] }));
      showSaveStatus('saved');
      setEditTarget({ type: 'phase', id: newPhase.id });
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleSaveTask = async (taskId, updates) => {
    const affectedPhase = data?.phases.find(p => p.tasks.some(t => t.id === taskId));
    const needsBoundsRecalc = affectedPhase && (updates.start !== undefined || updates.end !== undefined);
    let newBounds = null;
    if (needsBoundsRecalc) {
      const projected = affectedPhase.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
      newBounds = calcPhaseBounds(projected);
    }

    setData(prev => ({
      ...prev,
      phases: prev.phases.map(p => {
        if (!p.tasks.some(t => t.id === taskId)) return p;
        const updatedTasks = p.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
        return newBounds ? { ...p, tasks: updatedTasks, ...newBounds } : { ...p, tasks: updatedTasks };
      }),
    }));

    try {
      const fetches = [
        fetch(`/api/tasks/task/${taskId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }),
      ];
      if (newBounds && affectedPhase &&
          (newBounds.start !== affectedPhase.start || newBounds.end !== affectedPhase.end)) {
        fetches.push(fetch(`/api/tasks/phase/${affectedPhase.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newBounds),
        }));
      }
      const [taskRes] = await Promise.all(fetches);
      if (!taskRes.ok) throw new Error('Server error');
      const serverTask = await taskRes.json();

      setData(prev => ({
        ...prev,
        phases: prev.phases.map(p => {
          if (!p.tasks.some(t => t.id === taskId)) return p;
          const updatedTasks = p.tasks.map(t => t.id === taskId ? { ...t, ...serverTask } : t);
          const bounds = calcPhaseBounds(updatedTasks);
          return bounds ? { ...p, tasks: updatedTasks, ...bounds } : { ...p, tasks: updatedTasks };
        }),
      }));
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleDeleteTask = async (taskId) => {
    const affectedPhase = data?.phases.find(p => p.tasks.some(t => t.id === taskId));
    try {
      const res = await fetch(`/api/tasks/task/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server error');

      const newBounds = affectedPhase
        ? calcPhaseBounds(affectedPhase.tasks.filter(t => t.id !== taskId))
        : null;

      setData(prev => ({
        ...prev,
        phases: prev.phases.map(p => {
          if (!p.tasks.some(t => t.id === taskId)) return p;
          const updatedTasks = p.tasks.filter(t => t.id !== taskId);
          return newBounds ? { ...p, tasks: updatedTasks, ...newBounds } : { ...p, tasks: updatedTasks };
        }),
      }));

      if (affectedPhase && newBounds &&
          (newBounds.start !== affectedPhase.start || newBounds.end !== affectedPhase.end)) {
        fetch(`/api/tasks/phase/${affectedPhase.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newBounds),
        }).catch(() => {});
      }

      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleSavePhase = async (phaseId, updates) => {
    try {
      const res = await fetch(`/api/tasks/phase/${phaseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Server error');
      const updated = await res.json();
      setData(prev => ({
        ...prev,
        phases: prev.phases.map(p => p.id === phaseId ? { ...p, ...updated } : p),
      }));
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleDeletePhase = async (phaseId) => {
    try {
      const res = await fetch(`/api/tasks/phase/${phaseId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server error');
      setData(prev => ({
        ...prev,
        phases: prev.phases.filter(p => p.id !== phaseId),
      }));
      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleAddTask = async (phaseId) => {
    const phase = data.phases.find(p => p.id === phaseId);
    if (!phase) return;
    try {
      const res = await fetch(`/api/tasks/phase/${phaseId}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Task', start: phase.start, end: phase.end }),
      });
      if (!res.ok) throw new Error('Server error');
      const newTask = await res.json();
      setData(prev => ({
        ...prev,
        phases: prev.phases.map(p => p.id === phaseId
          ? { ...p, tasks: [...p.tasks, newTask] }
          : p
        ),
      }));
      showSaveStatus('saved');
      setEditTarget({ type: 'task', id: newTask.id });
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleReorderPhases = async (phaseOrder) => {
    setData(prev => {
      const phaseMap = Object.fromEntries(prev.phases.map(p => [p.id, p]));
      return { ...prev, phases: phaseOrder.map(id => phaseMap[id]).filter(Boolean) };
    });
    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phaseOrder }),
      });
      if (!res.ok) throw new Error('Server error');
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      fetch('/api/tasks').then(r => r.json()).then(d => setData(d)).catch(() => {});
    }
  };

  const handleReorderTasks = async (phaseId, taskOrder) => {
    setData(prev => ({
      ...prev,
      phases: prev.phases.map(p => {
        if (p.id !== phaseId) return p;
        const taskMap = Object.fromEntries(p.tasks.map(t => [t.id, t]));
        return { ...p, tasks: taskOrder.map(id => taskMap[id]).filter(Boolean) };
      }),
    }));
    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskOrders: { [phaseId]: taskOrder } }),
      });
      if (!res.ok) throw new Error('Server error');
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      fetch('/api/tasks').then(r => r.json()).then(d => setData(d)).catch(() => {});
    }
  };

  const handleDisconnectCalendar = async () => {
    try {
      await fetch('/api/calendar/disconnect', { method: 'POST' });
      setCalendarStatus(s => ({ ...s, connected: false }));
      setCalendarEvents([]);
    } catch (err) {}
  };

  const handleCalendarSave = useCallback(async (config) => {
    try {
      const res = await fetch('/api/calendar/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const result = await res.json().catch(() => null);
      const normalizedConfig = normalizeCalendarConfig(result?.config, config.backend);
      if (!res.ok || !normalizedConfig) {
        setCalendarNotice(serverRestartNotice);
        return false;
      }
      setCalendarConfig(normalizedConfig);
      setCalendarStatus(s => ({ ...s, connected: result.connected }));
      setCalendarNotice(null);
      if (result.connected) setShowCalendarSetup(false);
      return true;
    } catch (err) {
      setCalendarNotice(serverRestartNotice);
      return false;
    }
  }, [normalizeCalendarConfig, serverRestartNotice]);

  // ─── Historical snapshot handlers ────────────────────────────────────────────

  const handleReturnToCurrent = () => {
    setHistoricalSnapshot(null);
  };

  const handleMakeCurrent = async () => {
    if (!historicalSnapshot) return;
    try {
      const res = await fetch('/api/git/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: historicalSnapshot.tasks,
          state: historicalSnapshot.state,
        }),
      });
      if (!res.ok) throw new Error('Server error');
      setData(historicalSnapshot.tasks);
      setUiState(historicalSnapshot.state || uiState);
      setHistoricalSnapshot(null);
      showSaveStatus('saved');
    } catch (err) {
      alert('Failed to restore snapshot');
    }
  };

  // ─── PDF export ──────────────────────────────────────────────────────────────

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const [{ jsPDF }, html2canvas, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
        import('jspdf-autotable'),
      ]);

      const displayData = historicalSnapshot ? historicalSnapshot.tasks : data;

      // Capture the gantt body element
      const ganttBody = document.querySelector('.gantt-body');
      if (!ganttBody) throw new Error('Gantt element not found');

      const canvas = await html2canvas.default(ganttBody, {
        backgroundColor: '#0f1117',
        scale: 1.5,
        useCORS: true,
        logging: false,
      });

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;
      const contentW = pageW - margin * 2;

      // Header
      const exportDate = new Date().toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      doc.setFontSize(14);
      doc.setTextColor(40, 40, 40);
      doc.text('Project Timeline', margin, margin + 5);
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Exported ${exportDate}`, margin, margin + 11);

      // Gantt chart image
      const imgW = contentW;
      const imgH = Math.min((canvas.height / canvas.width) * imgW, pageH * 0.45);
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin + 16, imgW, imgH);

      // Task table
      const tableTop = margin + 16 + imgH + 6;
      const tableRows = [];
      for (const phase of displayData.phases) {
        tableRows.push([{ content: phase.name, colSpan: 5, styles: { fontStyle: 'bold', fillColor: [30, 36, 51] } }]);
        for (const task of phase.tasks) {
          tableRows.push([
            '',
            task.name,
            task.start || '',
            task.milestone ? task.start : (task.end || ''),
            task.done ? '✓' : '',
          ]);
        }
      }

      autoTable(doc, {
        startY: tableTop,
        head: [['Phase', 'Task', 'Start', 'End', 'Status']],
        body: tableRows,
        margin: { left: margin, right: margin },
        styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
        headStyles: { fillColor: [42, 49, 66], textColor: 230, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 22, font: 'courier' },
          3: { cellWidth: 22, font: 'courier' },
          4: { cellWidth: 14, halign: 'center' },
        },
        didDrawPage: (hookData) => {
          doc.setFontSize(8);
          doc.setTextColor(160, 160, 160);
          doc.text(`Page ${hookData.pageNumber}`, pageW - margin, pageH - 6, { align: 'right' });
        },
      });

      const today = new Date().toISOString().slice(0, 10);
      doc.save(`gantt-export-${today}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('PDF export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  // Find the item being edited
  const getEditItem = () => {
    if (!editTarget || !data) return null;
    if (editTarget.type === 'phase') {
      return data.phases.find(p => p.id === editTarget.id) || null;
    }
    for (const phase of data.phases) {
      const task = phase.tasks.find(t => t.id === editTarget.id);
      if (task) return task;
    }
    return null;
  };

  const handleUiStateChange = useCallback((nextUiState) => {
    setUiState(prev => {
      const current = prev || {};
      if (JSON.stringify(current) === JSON.stringify(nextUiState)) return prev;
      if (uiStateSaveTimerRef.current) clearTimeout(uiStateSaveTimerRef.current);
      uiStateSaveTimerRef.current = setTimeout(() => {
        fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextUiState),
        }).catch(() => {});
      }, 150);
      return nextUiState;
    });
  }, []);

  useEffect(() => () => {
    if (uiStateSaveTimerRef.current) clearTimeout(uiStateSaveTimerRef.current);
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <p>{error}</p>
      </div>
    );
  }

  const isHistorical = !!historicalSnapshot;
  const displayData = isHistorical ? historicalSnapshot.tasks : data;
  const displayUiState = isHistorical ? (historicalSnapshot.state || uiState) : uiState;

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-title">Gantt</span>
          {!isHistorical && (
            <button className="btn btn-primary" onClick={handleAddPhase}>
              + Add Phase
            </button>
          )}
        </div>
        <div className="top-bar-right">
          {saveStatus === 'saved' && (
            <span className="save-indicator saved">Saved ✓</span>
          )}
          {saveStatus === 'failed' && (
            <span className="save-indicator failed">Save failed ✗</span>
          )}
          {gitStatus.dirty && !isHistorical && (
            <button
              className="btn btn-ghost btn-small git-dirty-btn"
              onClick={() => setShowHistoryPanel(true)}
              title="Planning data or GUI state has uncommitted changes — click to view history"
            >
              ● Uncommitted changes
            </button>
          )}
          <button
            className="btn btn-ghost btn-small"
            onClick={() => setShowHistoryPanel(true)}
            title="View snapshot history"
          >
            History
          </button>
          <button
            className="btn btn-ghost btn-small"
            onClick={handleExportPdf}
            disabled={exporting}
            title="Export as PDF"
          >
            {exporting ? 'Generating PDF…' : 'Export PDF'}
          </button>
          {calendarStatus.connected ? (
            <div className="calendar-status connected">
              <span>Calendar connected</span>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => setShowCalendarSetup(true)}
              >
                Manage
              </button>
            </div>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={() => setShowCalendarSetup(true)}
            >
              Connect Calendar
            </button>
          )}
        </div>
      </header>

      {/* Snapshot warning banner */}
      {isHistorical && (
        <div className="snapshot-banner">
          <span className="snapshot-banner-icon">⚠</span>
          <span className="snapshot-banner-text">
            You are viewing a snapshot from{' '}
            <strong>{new Date(historicalSnapshot.date).toLocaleString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}</strong>
            {historicalSnapshot.message ? ` — "${historicalSnapshot.message}"` : ''}
            {' '}— this is not your current data. Changes are disabled.
          </span>
          <button className="btn btn-small snapshot-banner-btn-return" onClick={handleReturnToCurrent}>
            Return to current
          </button>
          <button className="btn btn-small snapshot-banner-btn-restore" onClick={handleMakeCurrent}>
            Make this current
          </button>
        </div>
      )}

      {calendarNotice && (
        <div className="calendar-notice-banner">
          <span className="calendar-notice-icon">⚠</span>
          <span className="calendar-notice-text">{calendarNotice}</span>
          <button className="btn btn-small btn-ghost" onClick={() => setCalendarNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="app-main">
        {displayData && (
          <GanttView
            data={displayData}
            uiState={displayUiState}
            calendarConfig={calendarConfig}
            calendarEvents={calendarEvents}
            calendarConnected={calendarStatus.connected}
            onTaskClick={(taskId) => !isHistorical && setEditTarget({ type: 'task', id: taskId })}
            onPhaseClick={(phaseId) => !isHistorical && setEditTarget({ type: 'phase', id: phaseId })}
            onAddTask={handleAddTask}
            onTaskUpdate={handleSaveTask}
            onPhaseUpdate={handleSavePhase}
            onSaveStatus={showSaveStatus}
            onCalendarSetup={() => setShowCalendarSetup(true)}
            onReorderPhases={handleReorderPhases}
            onReorderTasks={handleReorderTasks}
            onUiStateChange={!isHistorical ? handleUiStateChange : undefined}
            readonly={isHistorical}
          />
        )}
      </main>

      {showCalendarSetup && (
        <CalendarSetupModal
          status={calendarStatus}
          config={calendarConfig}
          onSave={handleCalendarSave}
          onClose={() => setShowCalendarSetup(false)}
        />
      )}

      {editTarget && !isHistorical && (
        <TaskEditor
          item={getEditItem()}
          type={editTarget.type}
          phaseColors={PHASE_COLORS}
          onSave={(updates) => {
            if (editTarget.type === 'task') handleSaveTask(editTarget.id, updates);
            else handleSavePhase(editTarget.id, updates);
          }}
          onDelete={() => {
            if (editTarget.type === 'task') handleDeleteTask(editTarget.id);
            else handleDeletePhase(editTarget.id);
          }}
          onClose={() => setEditTarget(null)}
        />
      )}

      {showHistoryPanel && (
        <HistoryPanel
          onClose={() => setShowHistoryPanel(false)}
          onViewSnapshot={setHistoricalSnapshot}
          gitStatus={gitStatus}
          onCommitted={refreshGitStatus}
        />
      )}
    </div>
  );
}

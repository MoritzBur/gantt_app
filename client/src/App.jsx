import React, { useState, useEffect, useCallback, useMemo } from 'react';
import GanttView from './components/GanttView.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import CalendarSetupModal from './components/CalendarSetupModal.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';

const PHASE_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

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
  const [calendarStatus, setCalendarStatus] = useState({ connected: false });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'failed'
  const [saveTimer, setSaveTimer] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // { type: 'task'|'phase', id }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [calendarConfig, setCalendarConfig] = useState(null);

  // Git status
  const [gitDirty, setGitDirty] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // Historical snapshot — { data, hash, date, message } or null
  const [historicalSnapshot, setHistoricalSnapshot] = useState(null);

  // PDF export
  const [exporting, setExporting] = useState(false);

  // Load tasks on mount — retry a few times to handle the Express startup race
  useEffect(() => {
    const load = async (attempt = 0) => {
      try {
        const r = await fetch('/api/tasks');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        setData(d);
        setLoading(false);
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
  }, []);

  // Load calendar status and config on mount
  useEffect(() => {
    fetch('/api/calendar/status')
      .then(r => r.json())
      .then(s => setCalendarStatus(s))
      .catch(() => {});
    fetch('/api/calendar/config')
      .then(r => r.json())
      .then(c => setCalendarConfig(c))
      .catch(() => {});
  }, []);

  // Poll git status every 30s
  const refreshGitStatus = useCallback(() => {
    fetch('/api/git/status')
      .then(r => r.json())
      .then(s => setGitDirty(s.dirty))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshGitStatus();
    const interval = setInterval(refreshGitStatus, 30000);
    return () => clearInterval(interval);
  }, [refreshGitStatus]);

  // Compute the calendar date range as a string
  const calendarDateRange = useMemo(() => {
    if (!data || data.phases.length === 0) return null;
    const allDates = data.phases.flatMap(p => [p.start, p.end]).filter(Boolean).sort();
    if (allDates.length === 0) return null;
    const start = new Date(allDates[0]);
    const end = new Date(allDates[allDates.length - 1]);
    start.setDate(start.getDate() - 14);
    end.setDate(end.getDate() + 14);
    return `${start.toISOString().slice(0, 10)}/${end.toISOString().slice(0, 10)}`;
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
  }, [calendarStatus.connected, calendarDateRange]);

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

  const handleCalendarSave = async (config) => {
    try {
      const res = await fetch('/api/calendar/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) return false;
      const result = await res.json();
      setCalendarConfig(config);
      setCalendarStatus(s => ({ ...s, connected: result.connected }));
      if (result.connected) setShowCalendarSetup(false);
      return true;
    } catch (err) {
      return false;
    }
  };

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
        body: JSON.stringify(historicalSnapshot.data),
      });
      if (!res.ok) throw new Error('Server error');
      setData(historicalSnapshot.data);
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

      const displayData = historicalSnapshot ? historicalSnapshot.data : data;

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
  const displayData = isHistorical ? historicalSnapshot.data : data;

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
          {gitDirty && !isHistorical && (
            <button
              className="btn btn-ghost btn-small git-dirty-btn"
              onClick={() => setShowHistoryPanel(true)}
              title="data/tasks.json has uncommitted changes — click to view history"
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

      <main className="app-main">
        {displayData && (
          <GanttView
            data={displayData}
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
          gitDirty={gitDirty}
          onCommitted={refreshGitStatus}
        />
      )}
    </div>
  );
}

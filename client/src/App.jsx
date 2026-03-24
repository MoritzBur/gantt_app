import React, { useState, useEffect, useCallback, useMemo } from 'react';
import GanttView from './components/GanttView.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import CalendarSetupModal from './components/CalendarSetupModal.jsx';

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
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    try { await fetch('/api/restart', { method: 'POST' }); } catch (_) {}
    // Vite HMR will reconnect and reload the page automatically
  };

  // Load tasks on mount
  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError('Failed to load tasks: ' + err.message); setLoading(false); });
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

  // Compute the calendar date range as a string — only changes when task dates change,
  // not on reorders (which don't affect dates). This prevents spurious re-fetches.
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
  }, [saveTimer]);

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
      // Open editor for new phase immediately
      setEditTarget({ type: 'phase', id: newPhase.id });
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleSaveTask = async (taskId, updates) => {
    // Find affected phase and compute new bounds if dates are changing
    const affectedPhase = data?.phases.find(p => p.tasks.some(t => t.id === taskId));
    const needsBoundsRecalc = affectedPhase && (updates.start !== undefined || updates.end !== undefined);
    let newBounds = null;
    if (needsBoundsRecalc) {
      const projected = affectedPhase.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
      newBounds = calcPhaseBounds(projected);
    }

    // Optimistic update — task + phase bounds
    setData(prev => ({
      ...prev,
      phases: prev.phases.map(p => {
        if (!p.tasks.some(t => t.id === taskId)) return p;
        const updatedTasks = p.tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
        return newBounds ? { ...p, tasks: updatedTasks, ...newBounds } : { ...p, tasks: updatedTasks };
      }),
    }));

    try {
      // Save task; also save phase bounds to server if they changed
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

      // Confirm with server-returned task data and recompute bounds
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

      // Recalculate phase bounds without the deleted task
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

      // Persist updated phase bounds
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

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-title">Gantt</span>
          <button className="btn btn-primary" onClick={handleAddPhase}>
            + Add Phase
          </button>
        </div>
        <div className="top-bar-right">
          {restarting && <span className="save-indicator">Restarting…</span>}
          {saveStatus === 'saved' && (
            <span className="save-indicator saved">Saved ✓</span>
          )}
          {saveStatus === 'failed' && (
            <span className="save-indicator failed">Save failed ✗</span>
          )}
          <button
            className="btn btn-ghost btn-small"
            onClick={handleRestart}
            disabled={restarting}
            title="Restart server"
          >
            ↺
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

      <main className="app-main">
        {data && (
          <GanttView
            data={data}
            calendarEvents={calendarEvents}
            calendarConnected={calendarStatus.connected}
            onTaskClick={(taskId) => setEditTarget({ type: 'task', id: taskId })}
            onPhaseClick={(phaseId) => setEditTarget({ type: 'phase', id: phaseId })}
            onAddTask={handleAddTask}
            onTaskUpdate={handleSaveTask}
            onPhaseUpdate={handleSavePhase}
            onSaveStatus={showSaveStatus}
            onCalendarSetup={() => setShowCalendarSetup(true)}
            onReorderPhases={handleReorderPhases}
            onReorderTasks={handleReorderTasks}
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

      {editTarget && (
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
    </div>
  );
}

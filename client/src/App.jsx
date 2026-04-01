import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import GanttView from './components/GanttView.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import CalendarSetupModal from './components/CalendarSetupModal.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import QuickBatchSubtasks from './components/QuickBatchSubtasks.jsx';

const PHASE_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

// ─── Tree helpers (client-side) ──────────────────────────────────────────────

/** Find node by id in recursive tree. Returns node or null. */
function findNodeInTree(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findNodeInTree(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find parent of a node. Returns the parent node, or null for top-level. */
function findParentInTree(items, id, parent = null) {
  for (const item of items) {
    if (item.id === id) return parent;
    if (item.children) {
      const found = findParentInTree(item.children, id, item);
      if (found !== undefined) return found;
    }
  }
  return undefined; // not found at all
}

/** Collect all dates from the tree for calendar range calculation */
function collectAllDates(items) {
  const dates = [];
  for (const item of items) {
    if (item.start) dates.push(item.start);
    if (item.end) dates.push(item.end);
    if (item.children) dates.push(...collectAllDates(item.children));
  }
  return dates;
}

/** Update a node in the tree immutably. Returns new items array. */
function updateNodeInTree(items, id, updater) {
  return items.map(item => {
    if (item.id === id) return updater(item);
    if (item.children) {
      const updatedChildren = updateNodeInTree(item.children, id, updater);
      if (updatedChildren !== item.children) return { ...item, children: updatedChildren };
    }
    return item;
  });
}

/** Remove a node from the tree immutably. Returns new items array. */
function removeNodeFromTree(items, id) {
  const filtered = items.filter(item => item.id !== id);
  if (filtered.length !== items.length) return filtered;
  return items.map(item => {
    if (item.children) {
      const updatedChildren = removeNodeFromTree(item.children, id);
      if (updatedChildren !== item.children) return { ...item, children: updatedChildren };
    }
    return item;
  });
}

/** Get the inherited color for a node (walks up to find nearest group with color) */
function getInheritedColor(items, id) {
  const parent = findParentInTree(items, id);
  if (parent === undefined) return '#4A90D9';
  if (parent === null) {
    const node = findNodeInTree(items, id);
    return node?.color || '#4A90D9';
  }
  return parent.color || getInheritedColor(items, parent.id);
}

/** Build PDF table rows recursively */
function buildPdfRows(items, depth = 0) {
  const rows = [];
  for (const item of items) {
    if (item.type === 'group') {
      rows.push([{ content: '  '.repeat(depth) + item.name, colSpan: 5, styles: { fontStyle: 'bold', fillColor: [30, 36, 51] } }]);
      if (item.children) rows.push(...buildPdfRows(item.children, depth + 1));
    } else {
      rows.push([
        '  '.repeat(depth),
        item.name,
        item.start || '',
        item.milestone ? item.start : (item.end || ''),
        item.done ? '\u2713' : '',
      ]);
    }
  }
  return rows;
}

function DeleteConfirmModal({ target, onConfirm, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!target) return null;

  const { name, childCount } = target;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="delete-confirm-title">Delete Group</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-copy">
            <strong>{name}</strong> contains {childCount} child item{childCount === 1 ? '' : 's'}.
          </p>
          <p className="delete-confirm-copy">
            Deleting it will remove the whole group and all nested tasks.
          </p>
        </div>
        <div className="modal-footer">
          <div className="modal-footer-right">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={onConfirm}>Delete Group</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [uiState, setUiState] = useState(null);
  const [calendarStatus, setCalendarStatus] = useState({ connected: false });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveTimer, setSaveTimer] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // { type: 'group'|'task', id }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [calendarConfig, setCalendarConfig] = useState(null);
  const [quickBatchTarget, setQuickBatchTarget] = useState(null); // { id, x, y }

  const [gitDirty, setGitDirty] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historicalSnapshot, setHistoricalSnapshot] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const uiStateSaveTimerRef = useRef(null);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  const readLegacyUiState = useCallback(() => {
    try {
      const zoom = localStorage.getItem('gantt-zoom') || 'Month';
      const density = localStorage.getItem('gantt-density') === 'Compact' ? 'Compact' : 'Regular';
      const collapsed = JSON.parse(localStorage.getItem('gantt-collapsed') || '{}');
      const activeCalEvents = JSON.parse(localStorage.getItem('gantt-active-cal-events') || '[]');
      const listWidth = parseInt(localStorage.getItem('gantt-list-width') || '260', 10);
      return {
        zoom,
        density,
        collapsed: collapsed && typeof collapsed === 'object' ? collapsed : {},
        activeCalEvents: Array.isArray(activeCalEvents) ? activeCalEvents : [],
        listWidth: Number.isFinite(listWidth) ? listWidth : 260,
      };
    } catch {
      return { zoom: 'Month', density: 'Regular', collapsed: {}, activeCalEvents: [], listWidth: 260 };
    }
  }, []);

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
        const nextUiState = shouldMigrateLegacy
          ? legacyState
          : {
              zoom: serverState.zoom,
              density: serverState.density,
              collapsed: serverState.collapsed,
              activeCalEvents: serverState.activeCalEvents,
              listWidth: serverState.listWidth,
            };
        setData(d);
        setUiState(nextUiState);
        setLoading(false);
        if (shouldMigrateLegacy) {
          fetch('/api/state', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(legacyState),
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

  const calendarDateRange = useMemo(() => {
    if (!data || !data.items || data.items.length === 0) return null;
    const allDates = collectAllDates(data.items).filter(Boolean).sort();
    if (allDates.length === 0) return null;
    const start = new Date(allDates[0]);
    const end = new Date(allDates[allDates.length - 1]);
    start.setDate(start.getDate() - 14);
    end.setDate(end.getDate() + 14);
    return `${start.toISOString().slice(0, 10)}/${end.toISOString().slice(0, 10)}`;
  }, [data]);

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
    setTimeout(refreshGitStatus, 500);
  }, [saveTimer, refreshGitStatus]);

  // ─── Node CRUD handlers (unified for groups and tasks) ──────────────────────

  const handleAddChild = async (parentId, type = 'task') => {
    try {
      const body = { parentId, type, name: type === 'group' ? 'New Group' : 'New Task' };
      if (type === 'group' && parentId === null) {
        const today = new Date().toISOString().slice(0, 10);
        const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const colorIdx = data ? data.items.length % PHASE_COLORS.length : 0;
        body.color = PHASE_COLORS[colorIdx];
        body.start = today;
        body.end = nextMonth;
      }
      if (type === 'group' && parentId) {
        const parent = findNodeInTree(data.items, parentId);
        if (parent?.color) body.color = parent.color;
      }
      const res = await fetch('/api/tasks/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Server error');
      const newNode = await res.json();
      // Re-fetch full data to get updated bounds
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
      setEditTarget({ type: newNode.type, id: newNode.id });
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleSaveNode = async (nodeId, updates) => {
    // Optimistic update
    setData(prev => ({
      ...prev,
      items: updateNodeInTree(prev.items, nodeId, node => ({ ...node, ...updates })),
    }));

    try {
      const res = await fetch(`/api/tasks/node/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Server error');
      // Re-fetch to get recomputed bounds
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const performDeleteNode = async (nodeId) => {
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server error');
      // Re-fetch to get updated bounds
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleDeleteNode = async (nodeId) => {
    const node = dataRef.current ? findNodeInTree(dataRef.current.items, nodeId) : null;
    const childCount = node?.children?.length || 0;
    if (node?.type === 'group' && childCount > 0) {
      setDeleteConfirmTarget({
        id: nodeId,
        name: node.name,
        childCount,
      });
      return;
    }
    await performDeleteNode(nodeId);
  };

  const handleDeleteNodes = async (nodeIds) => {
    try {
      await Promise.all(nodeIds.map((nodeId) => fetch(`/api/tasks/node/${nodeId}`, { method: 'DELETE' })));
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleSaveNodes = async (updatesByNodeId) => {
    setData(prev => ({
      ...prev,
      items: updatesByNodeId.reduce(
        (items, { nodeId, updates }) => updateNodeInTree(items, nodeId, node => ({ ...node, ...updates })),
        prev.items,
      ),
    }));

    try {
      await Promise.all(updatesByNodeId.map(({ nodeId, updates }) => fetch(`/api/tasks/node/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })));
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
    }
  };

  const handleReorder = async (parentId, childOrder) => {
    // Optimistic update
    setData(prev => {
      if (parentId === null) {
        const map = Object.fromEntries(prev.items.map(n => [n.id, n]));
        return { ...prev, items: childOrder.map(id => map[id]).filter(Boolean) };
      }
      return {
        ...prev,
        items: updateNodeInTree(prev.items, parentId, node => {
          const map = Object.fromEntries(node.children.map(n => [n.id, n]));
          return { ...node, children: childOrder.map(id => map[id]).filter(Boolean) };
        }),
      };
    });

    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, childOrder }),
      });
      if (!res.ok) throw new Error('Server error');
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
    }
  };

  const handleSplitNode = async (nodeId) => {
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}/split`, { method: 'POST' });
      if (!res.ok) throw new Error('Server error');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
    }
  };

  const handleBatchCreateSubtasks = async (nodeId, markdown) => {
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}/batch-subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
      if (!res.ok) throw new Error('Server error');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      showSaveStatus('saved');
      setEditTarget(null);
      setQuickBatchTarget(null);
      return true;
    } catch (err) {
      showSaveStatus('failed');
      return false;
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

  const handleReturnToCurrent = () => setHistoricalSnapshot(null);

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

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const [{ jsPDF }, html2canvas, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
        import('jspdf-autotable'),
      ]);

      const displayData = historicalSnapshot ? historicalSnapshot.tasks : data;
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

      const exportDate = new Date().toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      doc.setFontSize(14);
      doc.setTextColor(40, 40, 40);
      doc.text('Project Timeline', margin, margin + 5);
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Exported ${exportDate}`, margin, margin + 11);

      const imgW = contentW;
      const imgH = Math.min((canvas.height / canvas.width) * imgW, pageH * 0.45);
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin + 16, imgW, imgH);

      const tableTop = margin + 16 + imgH + 6;
      const tableRows = buildPdfRows(displayData.items || []);

      autoTable(doc, {
        startY: tableTop,
        head: [['Group', 'Item', 'Start', 'End', 'Status']],
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

  const getEditItem = () => {
    if (!editTarget || !data) return null;
    return findNodeInTree(data.items, editTarget.id) || null;
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

  if (loading) return <div className="app-loading"><p>Loading...</p></div>;
  if (error) return <div className="app-error"><p>{error}</p></div>;

  const isHistorical = !!historicalSnapshot;
  const displayData = isHistorical ? historicalSnapshot.tasks : data;
  const displayUiState = isHistorical ? (historicalSnapshot.state || uiState) : uiState;

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-title">Gantt</span>
        </div>
        <div className="top-bar-right">
          {saveStatus === 'saved' && (
            <span className="save-indicator saved">Saved &#10003;</span>
          )}
          {saveStatus === 'failed' && (
            <span className="save-indicator failed">Save failed &#10007;</span>
          )}
          {gitDirty && !isHistorical && (
            <button
              className="btn btn-ghost btn-small git-dirty-btn"
              onClick={() => setShowHistoryPanel(true)}
              title="Planning data or GUI state has uncommitted changes — click to view history"
            >
              &#9679; Uncommitted changes
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
            {exporting ? 'Generating PDF\u2026' : 'Export PDF'}
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

      {isHistorical && (
        <div className="snapshot-banner">
          <span className="snapshot-banner-icon">&#9888;</span>
          <span className="snapshot-banner-text">
            You are viewing a snapshot from{' '}
            <strong>{new Date(historicalSnapshot.date).toLocaleString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}</strong>
            {historicalSnapshot.message ? ` \u2014 "${historicalSnapshot.message}"` : ''}
            {' '}\u2014 this is not your current data. Changes are disabled.
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
            uiState={displayUiState}
            calendarEvents={calendarEvents}
            calendarConnected={calendarStatus.connected}
            onNodeClick={(nodeId) => {
              if (isHistorical) return;
              const node = findNodeInTree(displayData.items, nodeId);
              if (node) setEditTarget({ type: node.type, id: nodeId });
            }}
            onAddChild={handleAddChild}
            onQuickBatchCreate={(nodeId, position) => {
              setEditTarget(null);
              setQuickBatchTarget({ id: nodeId, ...position });
            }}
            onNodeUpdate={handleSaveNode}
            onNodeBulkUpdate={handleSaveNodes}
            onDeleteNode={handleDeleteNode}
            onDeleteNodes={handleDeleteNodes}
            onSplitNode={handleSplitNode}
            onSaveStatus={showSaveStatus}
            onCalendarSetup={() => setShowCalendarSetup(true)}
            onReorder={handleReorder}
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
          onSave={(updates) => handleSaveNode(editTarget.id, updates)}
          onDelete={() => handleDeleteNode(editTarget.id)}
          onBatchCreate={(markdown) => handleBatchCreateSubtasks(editTarget.id, markdown)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {quickBatchTarget && !isHistorical && (
        <QuickBatchSubtasks
          x={quickBatchTarget.x}
          y={quickBatchTarget.y}
          onCreate={(markdown) => handleBatchCreateSubtasks(quickBatchTarget.id, markdown)}
          onClose={() => setQuickBatchTarget(null)}
        />
      )}

      {deleteConfirmTarget && !isHistorical && (
        <DeleteConfirmModal
          target={deleteConfirmTarget}
          onClose={() => setDeleteConfirmTarget(null)}
          onConfirm={async () => {
            const nodeId = deleteConfirmTarget.id;
            setDeleteConfirmTarget(null);
            await performDeleteNode(nodeId);
          }}
        />
      )}

      {showHistoryPanel && (
        <HistoryPanel
          onClose={() => setShowHistoryPanel(false)}
          onViewSnapshot={(snapshot) => {
            // Auto-migrate v1 snapshots for display
            if (snapshot?.tasks && !snapshot.tasks.version && Array.isArray(snapshot.tasks.phases)) {
              snapshot = {
                ...snapshot,
                tasks: {
                  version: 2,
                  items: snapshot.tasks.phases.map(phase => {
                    const { tasks, ...rest } = phase;
                    return {
                      ...rest,
                      type: 'group',
                      prefix: phase.prefix !== undefined ? phase.prefix : 'WP',
                      children: (tasks || []).map(t => ({ ...t, type: 'task', children: [] })),
                    };
                  }),
                },
              };
            }
            setHistoricalSnapshot(snapshot);
          }}
          gitDirty={gitDirty}
          onCommitted={refreshGitStatus}
        />
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import GanttView from './components/GanttView.jsx';
import TaskEditor from './components/TaskEditor.jsx';
import CalendarSetupModal from './components/CalendarSetupModal.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import QuickBatchSubtasks from './components/QuickBatchSubtasks.jsx';
import NotePanel from './components/NotePanel.jsx';

const PHASE_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

const UNDO_STACK_LIMIT = 50;
const DEFAULT_NOTE_PANEL = {
  open: false,
  width: 420,
  tabs: [],
  activeTabIndex: 0,
};

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

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

function cloneTaskData(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function taskDataEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getDefaultNoteFilename(item) {
  if (!item) return 'note.md';
  return 'main.md';
}

function getNodePrefix(node) {
  return node.prefix !== undefined ? node.prefix : (node.type === 'group' ? 'WP' : '');
}

function getNodeNumber(numberPath) {
  return numberPath.join('.');
}

function getNodeLabel(node, numberPath) {
  const prefix = getNodePrefix(node);
  const num = getNodeNumber(numberPath);
  if (prefix) return `${prefix}\u00a0${num}\u2002${node.name}`;
  return `${num}\u2002${node.name}`;
}

function buildNoteItemMeta(items, numberPath = [], meta = {}, inheritedColor = null) {
  for (let index = 0; index < (items || []).length; index += 1) {
    const item = items[index];
    const nextNumberPath = [...numberPath, index + 1];
    const itemColor = item.color || inheritedColor || '#4A90D9';
    meta[item.id] = {
      id: item.id,
      type: item.type,
      name: item.name,
      number: getNodeNumber(nextNumberPath),
      label: getNodeLabel(item, nextNumberPath),
      color: itemColor,
    };
    if (item.children?.length) buildNoteItemMeta(item.children, nextNumberPath, meta, itemColor);
  }
  return meta;
}

function normalizeNotePanel(panel) {
  const tabs = Array.isArray(panel?.tabs)
    ? panel.tabs
      .filter((tab) => tab?.itemId && tab?.filename)
      .map((tab) => ({
        itemId: tab.itemId,
        filename: tab.filename,
        type: tab.type === 'related' ? 'related' : 'main',
        pinned: tab.pinned !== false,
      }))
    : [];

  return {
    open: !!panel?.open,
    width: Number.isFinite(panel?.width) ? panel.width : DEFAULT_NOTE_PANEL.width,
    tabs,
    activeTabIndex: Number.isInteger(panel?.activeTabIndex)
      ? Math.max(0, Math.min(panel.activeTabIndex, Math.max(tabs.length - 1, 0)))
      : 0,
  };
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

function WorkspaceCreateModal({ workspaces, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('empty');
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState(workspaces[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, submitting]);

  useEffect(() => {
    if (!workspaces.some((workspace) => workspace.id === sourceWorkspaceId)) {
      setSourceWorkspaceId(workspaces[0]?.id || '');
    }
  }, [sourceWorkspaceId, workspaces]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate({
        name: name.trim(),
        mode,
        sourceWorkspaceId: mode === 'clone' ? sourceWorkspaceId : null,
      });
    } catch (err) {
      setSubmitError(err.message || 'Failed to create workspace');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={submitting ? undefined : onClose}>
      <div
        className="modal workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-create-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="workspace-create-title">Create Workspace</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={submitting}>✕</button>
        </div>
        <form className="modal-body workspace-modal-form" onSubmit={handleSubmit}>
          <label className="workspace-field">
            <span className="workspace-field-label">Name</span>
            <input
              className="workspace-input"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My sandbox"
              autoFocus
            />
          </label>

          <label className="workspace-field">
            <span className="workspace-field-label">Start from</span>
            <select
              className="workspace-select"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="empty">Empty workspace</option>
              <option value="clone">Copy an existing workspace</option>
            </select>
          </label>

          {mode === 'clone' && (
            <label className="workspace-field">
              <span className="workspace-field-label">Source workspace</span>
              <select
                className="workspace-select"
                value={sourceWorkspaceId}
                onChange={(event) => setSourceWorkspaceId(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </label>
          )}

          <p className="workspace-help">
            Each workspace gets its own tasks, notes, calendar config, and UI state directory.
          </p>
          {submitError && <p className="workspace-error">{submitError}</p>}

          <div className="modal-footer">
            <div className="modal-footer-right">
              <button className="btn btn-ghost" type="button" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={!name.trim() || submitting}>
                {submitting ? 'Creating…' : 'Create Workspace'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function WorkspaceDeleteModal({ workspace, onConfirm, onClose, deleting, error }) {
  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'Escape' && !deleting) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleting, onClose]);

  if (!workspace) return null;

  return (
    <div className="modal-backdrop" onClick={deleting ? undefined : onClose}>
      <div
        className="modal workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-delete-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="workspace-delete-title">Delete Workspace</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={deleting}>✕</button>
        </div>
        <div className="modal-body workspace-modal-form">
          <p className="delete-confirm-copy">
            Delete <strong>{workspace.name}</strong> and all of its tasks, notes, calendar settings, and UI state?
          </p>
          <p className="workspace-help">
            This cannot be undone. The safe default is to cancel, and the app will switch to another workspace only if you confirm deletion.
          </p>
          {error && <p className="workspace-error">{error}</p>}
          <div className="modal-footer">
            <div className="modal-footer-right">
              <button className="btn btn-ghost" type="button" onClick={onClose} disabled={deleting} autoFocus>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={onConfirm} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Workspace'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [uiState, setUiState] = useState(null);
  const [workspaces, setWorkspaces] = useState({ activeWorkspaceId: null, workspaces: [] });
  const [calendarStatus, setCalendarStatus] = useState({ connected: false });
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [noteContentItemIds, setNoteContentItemIds] = useState(() => new Set());
  const [saveStatus, setSaveStatus] = useState(null);
  const [saveTimer, setSaveTimer] = useState(null);
  const [editTarget, setEditTarget] = useState(null); // { type: 'group'|'task', id }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCalendarSetup, setShowCalendarSetup] = useState(false);
  const [showWorkspaceCreate, setShowWorkspaceCreate] = useState(false);
  const [calendarConfig, setCalendarConfig] = useState(null);
  const [quickBatchTarget, setQuickBatchTarget] = useState(null); // { id, x, y }
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState(null);
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState(null);
  const [workspaceDeleting, setWorkspaceDeleting] = useState(false);

  const [gitDirty, setGitDirty] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historicalSnapshot, setHistoricalSnapshot] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [historyFeedback, setHistoryFeedback] = useState(null);
  const uiStateSaveTimerRef = useRef(null);
  const historyFeedbackTimerRef = useRef(null);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  const getWorkspaceHeaders = useCallback((workspaceId) => (
    workspaceId ? { 'x-workspace-id': workspaceId } : {}
  ), []);

  const showHistoryFeedback = useCallback((kind) => {
    setHistoryFeedback(kind);
    if (historyFeedbackTimerRef.current) clearTimeout(historyFeedbackTimerRef.current);
    historyFeedbackTimerRef.current = setTimeout(() => setHistoryFeedback(null), 900);
  }, []);

  const clearUndoHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const pushUndoSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    const cloned = cloneTaskData(snapshot);
    setUndoStack((prev) => {
      const next = [...prev, cloned];
      return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
    });
    setRedoStack([]);
  }, []);

  const persistWholeTaskData = useCallback(async (nextData) => {
    const res = await fetch('/api/tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextData),
    });
    if (!res.ok) throw new Error('Server error');
    return res.json();
  }, []);

  const readLegacyUiState = useCallback(() => {
    try {
      const theme = localStorage.getItem('gantt-theme');
      const zoom = localStorage.getItem('gantt-zoom') || 'Month';
      const density = localStorage.getItem('gantt-density') === 'Compact' ? 'Compact' : 'Regular';
      const collapsed = JSON.parse(localStorage.getItem('gantt-collapsed') || '{}');
      const activeCalEvents = JSON.parse(localStorage.getItem('gantt-active-cal-events') || '[]');
      const listWidth = parseInt(localStorage.getItem('gantt-list-width') || '260', 10);
      return {
        theme: theme === 'light' || theme === 'dark' ? theme : getSystemTheme(),
        zoom,
        density,
        collapsed: collapsed && typeof collapsed === 'object' ? collapsed : {},
        activeCalEvents: Array.isArray(activeCalEvents) ? activeCalEvents : [],
        listWidth: Number.isFinite(listWidth) ? listWidth : 260,
        notePanel: { ...DEFAULT_NOTE_PANEL },
      };
    } catch {
      return {
        theme: getSystemTheme(),
        zoom: 'Month',
        density: 'Regular',
        collapsed: {},
        activeCalEvents: [],
        listWidth: 260,
        notePanel: { ...DEFAULT_NOTE_PANEL },
      };
    }
  }, []);

  const loadAppData = useCallback(async (workspaceIdOverride = null) => {
    const workspaceId = workspaceIdOverride || workspaces.activeWorkspaceId || null;
    const headers = getWorkspaceHeaders(workspaceId);
    const [tasksRes, stateRes, workspacesRes, notesRes] = await Promise.all([
      fetch('/api/tasks'),
      fetch('/api/state', { headers }),
      fetch('/api/workspaces'),
      fetch('/api/notes/all', { headers }),
    ]);
    if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);
    if (!workspacesRes.ok) throw new Error(`Workspace HTTP ${workspacesRes.status}`);

    const d = await tasksRes.json();
    const serverState = stateRes.ok ? await stateRes.json() : null;
    const workspacePayload = await workspacesRes.json();
    const notesPayload = notesRes.ok ? await notesRes.json() : { notes: [] };
    const legacyState = readLegacyUiState();
    const shouldMigrateLegacy = !serverState?._exists;
    const nextUiState = shouldMigrateLegacy
      ? legacyState
      : {
          theme: serverState.theme === 'light' || serverState.theme === 'dark' ? serverState.theme : legacyState.theme,
          zoom: serverState.zoom,
          density: serverState.density,
          collapsed: serverState.collapsed,
          activeCalEvents: serverState.activeCalEvents,
          listWidth: serverState.listWidth,
          notePanel: normalizeNotePanel(serverState.notePanel),
        };

    setData(d);
    clearUndoHistory();
    setUiState(nextUiState);
    setError(null);
    setCalendarEvents([]);
    setNoteContentItemIds(new Set(
      (Array.isArray(notesPayload.notes) ? notesPayload.notes : [])
        .filter((note) => note.type === 'main' && note.hasContent)
        .map((note) => note.itemId)
    ));
    setWorkspaces({
      activeWorkspaceId: workspacePayload.activeWorkspaceId || null,
      workspaces: Array.isArray(workspacePayload.workspaces) ? workspacePayload.workspaces : [],
    });
    setLoading(false);
    if (shouldMigrateLegacy || (serverState && serverState.theme !== 'light' && serverState.theme !== 'dark')) {
      fetch('/api/state', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(nextUiState),
      }).catch(() => {});
    }
  }, [clearUndoHistory, getWorkspaceHeaders, readLegacyUiState, workspaces.activeWorkspaceId]);

  const refreshNoteContentIndex = useCallback(() => {
    fetch('/api/notes/all', { headers: getWorkspaceHeaders(workspaces.activeWorkspaceId) })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load note index');
        return response.json();
      })
      .then((payload) => {
        setNoteContentItemIds(new Set(
          (Array.isArray(payload.notes) ? payload.notes : [])
            .filter((note) => note.type === 'main' && note.hasContent)
            .map((note) => note.itemId)
        ));
      })
      .catch(() => {});
  }, [getWorkspaceHeaders, workspaces.activeWorkspaceId]);

  const handleMainNoteContentChange = useCallback((itemId, hasContent) => {
    if (!itemId) return;
    setNoteContentItemIds((current) => {
      const next = new Set(current);
      if (hasContent) next.add(itemId);
      else next.delete(itemId);
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, []);

  useEffect(() => {
    const load = async (attempt = 0) => {
      try {
        await loadAppData();
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
  }, [loadAppData]);

  useEffect(() => {
    const theme = (historicalSnapshot?.state?.theme || uiState?.theme || 'dark');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = '';
    };
  }, [historicalSnapshot?.state?.theme, uiState?.theme]);

  useEffect(() => {
    if (!loading) refreshNoteContentIndex();
  }, [loading, refreshNoteContentIndex, workspaces.activeWorkspaceId]);

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
  }, [refreshGitStatus, workspaces.activeWorkspaceId]);

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

  const calendarColorById = useMemo(() => {
    const entries = Array.isArray(calendarConfig?.calendars)
      ? calendarConfig.calendars.map((calendar) => [calendar.id, calendar.color])
      : [];
    return new Map(entries);
  }, [calendarConfig]);

  const displayCalendarEvents = useMemo(() => (
    calendarEvents.map((event) => ({
      ...event,
      color: calendarColorById.get(event.calendarKey) || event.color || '#4A90D9',
    }))
  ), [calendarColorById, calendarEvents]);

  const refreshCalendarEvents = useCallback((dateRange = calendarDateRange, connected = calendarStatus.connected) => {
    if (!connected || !dateRange) {
      setCalendarEvents([]);
      return;
    }
    const [startStr, endStr] = dateRange.split('/');
    fetch(`/api/calendar/events?start=${startStr}&end=${endStr}`)
      .then(r => r.json())
      .then(events => {
        if (Array.isArray(events)) setCalendarEvents(events);
      })
      .catch(() => {});
  }, [calendarDateRange, calendarStatus.connected, workspaces.activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/calendar/status').then(r => r.json()).catch(() => ({ connected: false })),
      fetch('/api/calendar/config').then(r => r.json()).catch(() => null),
    ]).then(([status, config]) => {
      if (cancelled) return;
      setCalendarStatus(status);
      setCalendarConfig(config);
      refreshCalendarEvents(calendarDateRange, status.connected);
    });

    return () => {
      cancelled = true;
    };
  }, [calendarDateRange, refreshCalendarEvents, workspaces.activeWorkspaceId]);

  const showSaveStatus = useCallback((status) => {
    setSaveStatus(status);
    if (saveTimer) clearTimeout(saveTimer);
    const timer = setTimeout(() => setSaveStatus(null), 1500);
    setSaveTimer(timer);
    setTimeout(refreshGitStatus, 500);
  }, [saveTimer, refreshGitStatus]);

  // ─── Node CRUD handlers (unified for groups and tasks) ──────────────────────

  const handleAddChild = useCallback(async (parentId, type = 'task') => {
    const currentData = dataRef.current;
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
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
      setEditTarget({ type: newNode.type, id: newNode.id });
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [data, pushUndoSnapshot, showSaveStatus]);

  const handleSaveNode = useCallback(async (nodeId, updates) => {
    const currentData = dataRef.current;
    const nextItems = updateNodeInTree(currentData.items, nodeId, node => ({ ...node, ...updates }));
    const nextData = { ...currentData, items: nextItems };
    if (taskDataEquals(currentData, nextData)) return;

    // Optimistic update
    setData(nextData);

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
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      setData(currentData);
    }
  }, [pushUndoSnapshot, showSaveStatus]);

  const performDeleteNode = useCallback(async (nodeId) => {
    const currentData = dataRef.current;
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server error');
      // Re-fetch to get updated bounds
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [pushUndoSnapshot, showSaveStatus]);

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

  const handleDeleteNodes = useCallback(async (nodeIds) => {
    const currentData = dataRef.current;
    try {
      await Promise.all(nodeIds.map((nodeId) => fetch(`/api/tasks/node/${nodeId}`, { method: 'DELETE' })));
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [pushUndoSnapshot, showSaveStatus]);

  const handleSaveNodes = useCallback(async (updatesByNodeId) => {
    const currentData = dataRef.current;
    const nextItems = updatesByNodeId.reduce(
      (items, { nodeId, updates }) => updateNodeInTree(items, nodeId, node => ({ ...node, ...updates })),
      currentData.items,
    );
    const nextData = { ...currentData, items: nextItems };
    if (taskDataEquals(currentData, nextData)) return;

    setData(nextData);

    try {
      await Promise.all(updatesByNodeId.map(({ nodeId, updates }) => fetch(`/api/tasks/node/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })));
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
    }
  }, [pushUndoSnapshot, showSaveStatus]);

  const handleReorder = useCallback(async (parentId, childOrder) => {
    const currentData = dataRef.current;
    // Optimistic update
    const nextData = (() => {
      if (parentId === null) {
        const map = Object.fromEntries(currentData.items.map(n => [n.id, n]));
        return { ...currentData, items: childOrder.map(id => map[id]).filter(Boolean) };
      }
      return {
        ...currentData,
        items: updateNodeInTree(currentData.items, parentId, node => {
          const map = Object.fromEntries(node.children.map(n => [n.id, n]));
          return { ...node, children: childOrder.map(id => map[id]).filter(Boolean) };
        }),
      };
    })();
    if (taskDataEquals(currentData, nextData)) return;
    setData(nextData);

    try {
      const res = await fetch('/api/tasks/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, childOrder }),
      });
      if (!res.ok) throw new Error('Server error');
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
    }
  }, [pushUndoSnapshot, showSaveStatus]);

  const handleSplitNode = useCallback(async (nodeId) => {
    const currentData = dataRef.current;
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}/split`, { method: 'POST' });
      if (!res.ok) throw new Error('Server error');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [pushUndoSnapshot, showSaveStatus]);

  const handleBatchCreateSubtasks = useCallback(async (nodeId, markdown) => {
    const currentData = dataRef.current;
    try {
      const res = await fetch(`/api/tasks/node/${nodeId}/batch-subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
      if (!res.ok) throw new Error('Server error');
      const dataRes = await fetch('/api/tasks');
      if (dataRes.ok) setData(await dataRes.json());
      pushUndoSnapshot(currentData);
      showSaveStatus('saved');
      setEditTarget(null);
      setQuickBatchTarget(null);
      return true;
    } catch (err) {
      showSaveStatus('failed');
      return false;
    }
  }, [pushUndoSnapshot, showSaveStatus]);

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
      if (!res.ok) return false;
      const result = await res.json();
      setCalendarConfig(result.config);
      setCalendarStatus(s => ({ ...s, connected: result.connected }));
      if (result.connected && calendarDateRange) {
        refreshCalendarEvents(calendarDateRange);
      }
      if (result.connected) setShowCalendarSetup(false);
      return true;
    } catch (err) {
      return false;
    }
  }, [calendarDateRange, refreshCalendarEvents]);

  const handleUndo = useCallback(async () => {
    const currentData = dataRef.current;
    if (!currentData || historicalSnapshot || undoStack.length === 0) return;

    const previousSnapshot = undoStack[undoStack.length - 1];
    if (taskDataEquals(previousSnapshot, currentData)) {
      setUndoStack((prev) => prev.slice(0, -1));
      return;
    }

    try {
      const restored = await persistWholeTaskData(previousSnapshot);
      setData(restored);
      setUndoStack((prev) => prev.slice(0, -1));
      setRedoStack((prev) => {
        const next = [...prev, cloneTaskData(currentData)];
        return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
      });
      showSaveStatus('saved');
      showHistoryFeedback('undo');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [historicalSnapshot, persistWholeTaskData, showHistoryFeedback, showSaveStatus, undoStack]);

  const handleRedo = useCallback(async () => {
    const currentData = dataRef.current;
    if (!currentData || historicalSnapshot || redoStack.length === 0) return;

    const nextSnapshot = redoStack[redoStack.length - 1];
    if (taskDataEquals(nextSnapshot, currentData)) {
      setRedoStack((prev) => prev.slice(0, -1));
      return;
    }

    try {
      const restored = await persistWholeTaskData(nextSnapshot);
      setData(restored);
      setRedoStack((prev) => prev.slice(0, -1));
      setUndoStack((prev) => {
        const next = [...prev, cloneTaskData(currentData)];
        return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
      });
      showSaveStatus('saved');
      showHistoryFeedback('redo');
      setEditTarget(null);
    } catch (err) {
      showSaveStatus('failed');
    }
  }, [historicalSnapshot, persistWholeTaskData, redoStack, showHistoryFeedback, showSaveStatus]);

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
      clearUndoHistory();
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
      const resolvedBg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f1117';

      const canvas = await html2canvas.default(ganttBody, {
        backgroundColor: resolvedBg,
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
      const merged = {
        ...current,
        ...nextUiState,
        notePanel: normalizeNotePanel(nextUiState.notePanel ?? current.notePanel),
      };
      if (JSON.stringify(current) === JSON.stringify(merged)) return prev;
      if (uiStateSaveTimerRef.current) clearTimeout(uiStateSaveTimerRef.current);
      uiStateSaveTimerRef.current = setTimeout(() => {
        fetch('/api/state', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...getWorkspaceHeaders(workspaces.activeWorkspaceId),
          },
          body: JSON.stringify(merged),
        }).catch(() => {});
      }, 150);
      return merged;
    });
  }, [getWorkspaceHeaders, workspaces.activeWorkspaceId]);

  const updateNotePanelState = useCallback((updater) => {
    setUiState((prev) => {
      const current = prev || {};
      const nextPanel = normalizeNotePanel(
        typeof updater === 'function'
          ? updater(normalizeNotePanel(current.notePanel))
          : updater
      );
      const merged = { ...current, notePanel: nextPanel };
      if (JSON.stringify(current) === JSON.stringify(merged)) return prev;
      if (uiStateSaveTimerRef.current) clearTimeout(uiStateSaveTimerRef.current);
      uiStateSaveTimerRef.current = setTimeout(() => {
        fetch('/api/state', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...getWorkspaceHeaders(workspaces.activeWorkspaceId),
          },
          body: JSON.stringify(merged),
        }).catch(() => {});
      }, 150);
      return merged;
    });
  }, [getWorkspaceHeaders, workspaces.activeWorkspaceId]);

  const openNoteTab = useCallback((itemId, options = {}) => {
    const currentData = dataRef.current;
    if (!currentData) return;

    const item = findNodeInTree(currentData.items, itemId);
    if (!item) return;

    const descriptor = {
      itemId,
      filename: options.filename || item.noteFile || getDefaultNoteFilename(item),
      type: options.type === 'related' ? 'related' : 'main',
      pinned: options.preview ? false : true,
    };

    updateNotePanelState((currentPanel) => {
      const current = normalizeNotePanel(currentPanel);
      const existingIndex = current.tabs.findIndex((tab) =>
        tab.itemId === descriptor.itemId &&
        tab.filename === descriptor.filename &&
        tab.type === descriptor.type
      );

      if (existingIndex >= 0) {
        const existingTab = current.tabs[existingIndex];
        if (!descriptor.pinned && existingTab.pinned) {
          return {
            ...current,
            open: true,
            activeTabIndex: existingIndex,
          };
        }

        const nextTabs = [...current.tabs];
        nextTabs[existingIndex] = {
          ...existingTab,
          pinned: descriptor.pinned ? true : existingTab.pinned,
        };
        return {
          ...current,
          open: true,
          tabs: nextTabs,
          activeTabIndex: existingIndex,
        };
      }

      const tabs = [...current.tabs];
      let activeTabIndex = current.activeTabIndex;

      if (!descriptor.pinned) {
        const previewIndex = tabs.findIndex((tab) => tab.pinned === false);
        if (previewIndex >= 0) {
          tabs[previewIndex] = descriptor;
          activeTabIndex = previewIndex;
        } else {
          tabs.push(descriptor);
          activeTabIndex = tabs.length - 1;
        }
      } else if (options.replaceActive && tabs[activeTabIndex]) {
        tabs[activeTabIndex] = descriptor;
      } else {
        tabs.push(descriptor);
        activeTabIndex = tabs.length - 1;
      }

      return {
        ...current,
        open: true,
        tabs,
        activeTabIndex,
      };
    });
  }, [updateNotePanelState]);

  useEffect(() => () => {
    if (uiStateSaveTimerRef.current) clearTimeout(uiStateSaveTimerRef.current);
    if (historyFeedbackTimerRef.current) clearTimeout(historyFeedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (historicalSnapshot) return;

      const target = event.target;
      const isEditable = target instanceof HTMLElement && (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      if (isEditable) return;

      const primaryModifier = event.ctrlKey || event.metaKey;
      if (!primaryModifier) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }

      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo, historicalSnapshot]);

  const handleThemeToggle = useCallback(() => {
    const currentTheme = uiState?.theme || 'dark';
    handleUiStateChange({
      ...(uiState || {}),
      theme: currentTheme === 'light' ? 'dark' : 'light',
    });
  }, [handleUiStateChange, uiState]);

  const handleWorkspaceSwitch = useCallback(async (workspaceId) => {
    if (!workspaceId || workspaceId === workspaces.activeWorkspaceId) return;
    setError(null);
    setLoading(true);
    setHistoricalSnapshot(null);
    setEditTarget(null);
    setShowHistoryPanel(false);
    setShowCalendarSetup(false);
    setShowWorkspaceCreate(false);
    try {
      const response = await fetch('/api/workspaces/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) throw new Error('Failed to switch workspace');
      await loadAppData(workspaceId);
      refreshGitStatus();
    } catch (err) {
      setError('Failed to switch workspace');
      setLoading(false);
    }
  }, [loadAppData, refreshGitStatus, workspaces.activeWorkspaceId]);

  const handleWorkspaceCreate = useCallback(async ({ name, mode, sourceWorkspaceId }) => {
    setError(null);
    setLoading(true);
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mode, sourceWorkspaceId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setLoading(false);
      throw new Error(payload.error || 'Failed to create workspace');
    }
    const payload = await response.json();
    setShowWorkspaceCreate(false);
    setHistoricalSnapshot(null);
    setEditTarget(null);
    setShowHistoryPanel(false);
    setShowCalendarSetup(false);
    setWorkspaceDeleteTarget(null);
    setWorkspaceDeleteError(null);
    await loadAppData(payload.activeWorkspaceId || null);
    refreshGitStatus();
  }, [loadAppData, refreshGitStatus]);

  const handleWorkspaceDelete = useCallback(async () => {
    if (!workspaceDeleteTarget?.id || workspaceDeleting) return;
    setWorkspaceDeleting(true);
    setWorkspaceDeleteError(null);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceDeleteTarget.id)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to delete workspace');
      }
      setLoading(true);
      setWorkspaceDeleteTarget(null);
      setHistoricalSnapshot(null);
      setEditTarget(null);
      setShowHistoryPanel(false);
      setShowCalendarSetup(false);
      await loadAppData(payload.activeWorkspaceId || null);
      refreshGitStatus();
    } catch (err) {
      setWorkspaceDeleteError(err.message || 'Failed to delete workspace');
      setLoading(false);
    } finally {
      setWorkspaceDeleting(false);
    }
  }, [loadAppData, refreshGitStatus, workspaceDeleteTarget, workspaceDeleting]);

  const isHistorical = !!historicalSnapshot;
  const displayData = isHistorical ? historicalSnapshot.tasks : data;
  const displayUiState = isHistorical ? (historicalSnapshot.state || uiState) : uiState;
  const activeTheme = displayUiState?.theme || uiState?.theme || 'dark';
  const notePanelState = normalizeNotePanel(uiState?.notePanel);
  const noteItemMeta = useMemo(() => buildNoteItemMeta(displayData?.items || []), [displayData]);
  const activeWorkspace = useMemo(
    () => workspaces.workspaces.find((workspace) => workspace.id === workspaces.activeWorkspaceId) || null,
    [workspaces.activeWorkspaceId, workspaces.workspaces]
  );
  const activeNoteItemId = !isHistorical && notePanelState.open
    ? (notePanelState.tabs[notePanelState.activeTabIndex]?.itemId || null)
    : null;

  if (loading) return <div className="app-loading"><p>Loading...</p></div>;
  if (error) return <div className="app-error"><p>{error}</p></div>;

  return (
    <div className="app">
      <header className="top-bar">
        <div className="top-bar-left">
          <span className="app-title">Gantt</span>
          <div className="workspace-switcher">
            <select
              className="workspace-select"
              value={workspaces.activeWorkspaceId || ''}
              onChange={(event) => handleWorkspaceSwitch(event.target.value)}
              disabled={isHistorical || loading}
              title="Choose workspace"
            >
              {workspaces.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.kind === 'example' ? `${workspace.name} · Example` : workspace.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => setShowWorkspaceCreate(true)}
              disabled={isHistorical || loading}
              title="Create a new workspace"
            >
              New Workspace
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => {
                setWorkspaceDeleteError(null);
                setWorkspaceDeleteTarget(activeWorkspace);
              }}
              disabled={isHistorical || loading || !activeWorkspace?.deletable}
              title={activeWorkspace?.deletable ? 'Delete the current workspace' : 'This workspace cannot be deleted'}
            >
              Delete Workspace
            </button>
          </div>
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
          <button
            className="btn btn-ghost btn-small"
            onClick={handleThemeToggle}
            disabled={isHistorical}
            title={activeTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {activeTheme === 'light' ? 'Dark mode' : 'Light mode'}
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
            calendarEvents={displayCalendarEvents}
            calendarConnected={calendarStatus.connected}
            onNodeClick={(nodeId) => {
              if (isHistorical) return;
              const node = findNodeInTree(displayData.items, nodeId);
              if (node) setEditTarget({ type: node.type, id: nodeId });
            }}
            onPreviewNote={(nodeId) => {
              if (isHistorical) return;
              openNoteTab(nodeId, { preview: true });
            }}
            onAddChild={handleAddChild}
            onQuickBatchCreate={(nodeId, position) => {
              setEditTarget(null);
              setQuickBatchTarget({ id: nodeId, ...position });
            }}
            onOpenNote={(nodeId, options) => {
              if (isHistorical) return;
              openNoteTab(nodeId, options);
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
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={!isHistorical && undoStack.length > 0}
            canRedo={!isHistorical && redoStack.length > 0}
            historyFeedback={historyFeedback}
            activeNoteItemId={activeNoteItemId}
            noteContentItemIds={noteContentItemIds}
            readonly={isHistorical}
          />
        )}
        {!isHistorical && (
          <NotePanel
            workspaceId={workspaces.activeWorkspaceId}
            panelState={notePanelState}
            theme={activeTheme}
            itemMeta={noteItemMeta}
            onPanelStateChange={updateNotePanelState}
            onOpenNote={openNoteTab}
            onMainNoteContentChange={handleMainNoteContentChange}
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
          onOpenNote={() => {
            openNoteTab(editTarget.id);
            setEditTarget(null);
          }}
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

      {showWorkspaceCreate && !isHistorical && (
        <WorkspaceCreateModal
          workspaces={workspaces.workspaces}
          onCreate={handleWorkspaceCreate}
          onClose={() => setShowWorkspaceCreate(false)}
        />
      )}

      {workspaceDeleteTarget && !isHistorical && (
        <WorkspaceDeleteModal
          workspace={workspaceDeleteTarget}
          deleting={workspaceDeleting}
          error={workspaceDeleteError}
          onConfirm={handleWorkspaceDelete}
          onClose={() => {
            if (workspaceDeleting) return;
            setWorkspaceDeleteError(null);
            setWorkspaceDeleteTarget(null);
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

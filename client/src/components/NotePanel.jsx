import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NotePanelTab, { getTabKey } from './NotePanelTab.jsx';
import ContextMenu from './ContextMenu.jsx';

const MIN_WIDTH = 280;
const MAX_WIDTH_RATIO = 0.6;

function clampWidth(width) {
  return Math.max(MIN_WIDTH, Math.min(Math.round(window.innerWidth * MAX_WIDTH_RATIO), width));
}

function getEndpoint(tab) {
  return tab.type === 'related'
    ? `/api/notes/${tab.itemId}/related/${encodeURIComponent(tab.filename)}`
    : `/api/notes/${tab.itemId}?ensure=1`;
}

function getSaveEndpoint(tab) {
  return tab.type === 'related'
    ? `/api/notes/${tab.itemId}/related/${encodeURIComponent(tab.filename)}`
    : `/api/notes/${tab.itemId}`;
}

function getTabTitle(tab, content) {
  const firstHeading = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));

  if (firstHeading) return firstHeading.replace(/^#\s+/, '').trim();
  return (tab.filename || 'Untitled').replace(/\.md$/i, '');
}

function getVisibleTabLabel(tab, meta, cacheEntry) {
  if (tab?.type === 'main' && meta?.label) return meta.label;
  return (cacheEntry?.filename || tab?.filename || 'Untitled').replace(/\.md$/i, '');
}

function getWorkspaceHeaders(workspaceId) {
  return workspaceId ? { 'x-workspace-id': workspaceId } : {};
}

function toHistoryEntry(tab) {
  if (!tab?.itemId || !tab?.filename) return null;
  return {
    itemId: tab.itemId,
    filename: tab.filename,
    type: tab.type === 'related' ? 'related' : 'main',
  };
}

function DeleteNoteModal({ target, deleting, onConfirm, onClose }) {
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    if (!target || deleting) return;
    cancelButtonRef.current?.focus();
  }, [deleting, target]);

  useEffect(() => {
    if (!target || deleting) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleting, onClose, target]);

  if (!target) return null;

  const title = 'Delete Note';
  const primaryCopy = (
    <>
      Delete <strong>{target.label || target.filename.replace(/\.md$/i, '') || 'this note'}</strong>?
    </>
  );
  const secondaryCopy = target.type === 'main'
    ? 'This removes the current note file. If you open the task note again later, the app can create a fresh empty note.'
    : 'This removes the markdown file from the workspace. The safe choice is No unless you are sure.';
  const confirmLabel = deleting ? 'Deleting…' : 'Delete Note';

  return (
    <div className="modal-backdrop" onClick={deleting ? undefined : onClose}>
      <div
        className="modal delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-note-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title" id="delete-note-title">{title}</h2>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close" disabled={deleting}>✕</button>
        </div>
        <div className="modal-body">
          <p className="delete-confirm-copy">{primaryCopy}</p>
          <p className="delete-confirm-copy">{secondaryCopy}</p>
        </div>
        <div className="modal-footer">
          <div className="modal-footer-right">
            <button ref={cancelButtonRef} className="btn btn-ghost" type="button" onClick={onClose} disabled={deleting}>No</button>
            <button className="btn btn-danger" type="button" onClick={onConfirm} disabled={deleting}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NotePanel({ workspaceId, panelState, theme, itemMeta, onPanelStateChange, onOpenNote, onMainNoteContentChange }) {
  const [noteCache, setNoteCache] = useState({});
  const [allNotes, setAllNotes] = useState([]);
  const [relatedNotes, setRelatedNotes] = useState([]);
  const [relatedNotesLoading, setRelatedNotesLoading] = useState(false);
  const [newRelatedName, setNewRelatedName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingRelatedNote, setDeletingRelatedNote] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [draggedTabIndex, setDraggedTabIndex] = useState(null);
  const [navigation, setNavigation] = useState({ backStack: [], forwardStack: [] });
  const saveTimersRef = useRef({});
  const workspaceEpochRef = useRef(0);

  const normalizedPanel = useMemo(() => ({
    open: !!panelState?.open,
    width: Number.isFinite(panelState?.width) ? clampWidth(panelState.width) : 420,
    tabs: Array.isArray(panelState?.tabs)
      ? panelState.tabs.map((tab) => ({ ...tab, pinned: tab?.pinned !== false }))
      : [],
    activeTabIndex: Number.isInteger(panelState?.activeTabIndex) ? panelState.activeTabIndex : 0,
  }), [panelState]);

  const activeTab = normalizedPanel.tabs[normalizedPanel.activeTabIndex] || null;
  const activeTabKey = activeTab ? getTabKey(activeTab) : null;
  const activeCacheEntry = activeTabKey ? noteCache[activeTabKey] : null;
  const activeItemMeta = activeTab ? (itemMeta?.[activeTab.itemId] || null) : null;
  const canNavigateBack = navigation.backStack.length > 0;
  const canNavigateForward = navigation.forwardStack.length > 0;

  const refreshAllNotes = useCallback(() => {
    const requestEpoch = workspaceEpochRef.current;
    fetch('/api/notes/all', { headers: getWorkspaceHeaders(workspaceId) })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load notes');
        return response.json();
      })
      .then((payload) => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setAllNotes(Array.isArray(payload.notes) ? payload.notes : []);
      })
      .catch(() => {});
  }, [workspaceId]);

  const loadTab = useCallback((tab) => {
    if (!tab) return;
    const key = getTabKey(tab);
    const requestEpoch = workspaceEpochRef.current;

    setNoteCache((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        status: 'loading',
        message: '',
      },
    }));

    fetch(getEndpoint(tab), { headers: getWorkspaceHeaders(workspaceId) })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load note');
        return response.json();
      })
      .then((payload) => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        if (tab.type === 'main') {
          onMainNoteContentChange?.(tab.itemId, String(payload.content || '').trim().length > 0);
        }
        setNoteCache((current) => ({
          ...current,
          [key]: {
            status: 'ready',
            content: String(payload.content || ''),
            filename: payload.filename || tab.filename,
            workspacePath: payload.workspacePath || current[key]?.workspacePath || null,
            title: getTabTitle(tab, payload.content),
            saveState: current[key]?.saveState === 'dirty' ? 'dirty' : 'saved',
          },
        }));
        refreshAllNotes();
      })
      .catch(() => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setNoteCache((current) => ({
          ...current,
          [key]: {
            ...(current[key] || {}),
            status: 'error',
            message: 'This note could not be loaded.',
          },
        }));
      });
  }, [onMainNoteContentChange, refreshAllNotes, workspaceId]);

  useEffect(() => {
    refreshAllNotes();
  }, [refreshAllNotes]);

  useEffect(() => {
    if (normalizedPanel.open) refreshAllNotes();
  }, [normalizedPanel.open, refreshAllNotes]);

  useEffect(() => {
    if (!activeTab) return;
    const key = getTabKey(activeTab);
    if (!noteCache[key] || noteCache[key].status === 'error') {
      loadTab(activeTab);
    }
  }, [activeTab, loadTab, noteCache]);

  useEffect(() => {
    if (!activeTab) {
      setRelatedNotes([]);
      setRelatedNotesLoading(false);
      return;
    }

    const requestEpoch = workspaceEpochRef.current;
    setRelatedNotesLoading(true);
    fetch(`/api/notes/${activeTab.itemId}/related`, { headers: getWorkspaceHeaders(workspaceId) })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load related notes');
        return response.json();
      })
      .then((payload) => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setRelatedNotes(Array.isArray(payload.files) ? payload.files : []);
      })
      .catch(() => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setRelatedNotes([]);
      })
      .finally(() => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setRelatedNotesLoading(false);
      });
  }, [activeTab, workspaceId]);

  useEffect(() => () => {
    Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    workspaceEpochRef.current += 1;
    Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer));
    saveTimersRef.current = {};
    setNoteCache({});
    setAllNotes([]);
    setRelatedNotes([]);
    setRelatedNotesLoading(false);
    setNewRelatedName('');
    setDeleteTarget(null);
    setDeletingRelatedNote(false);
    setTabContextMenu(null);
    setNavigation({ backStack: [], forwardStack: [] });
  }, [workspaceId]);

  useEffect(() => {
    if (!normalizedPanel.open || !activeTab || activeTab.pinned) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.note-panel')) return;

      onPanelStateChange((currentPanel) => {
        const current = {
          open: !!currentPanel?.open,
          width: currentPanel?.width,
          tabs: Array.isArray(currentPanel?.tabs)
            ? currentPanel.tabs.map((tab) => ({ ...tab, pinned: tab?.pinned !== false }))
            : [],
          activeTabIndex: Number.isInteger(currentPanel?.activeTabIndex) ? currentPanel.activeTabIndex : 0,
        };

        const nextTabs = current.tabs.filter((tab) => tab.pinned !== false);
        return {
          ...current,
          open: nextTabs.length > 0,
          tabs: nextTabs,
          activeTabIndex: Math.max(0, Math.min(current.activeTabIndex, nextTabs.length - 1)),
        };
      });
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [activeTab, normalizedPanel.open, onPanelStateChange]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && normalizedPanel.open) {
        const activeElement = document.activeElement;
        const editorFocused = activeElement instanceof HTMLElement && activeElement.closest('.markdown-editor');
        if (!editorFocused) {
          onPanelStateChange({ ...normalizedPanel, open: false });
        }
        return;
      }

      const primaryModifier = event.ctrlKey || event.metaKey;
      if (!primaryModifier || normalizedPanel.tabs.length === 0) return;

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        const nextTabs = normalizedPanel.tabs.filter((_, index) => index !== normalizedPanel.activeTabIndex);
        onPanelStateChange({
          ...normalizedPanel,
          open: nextTabs.length > 0,
          tabs: nextTabs,
          activeTabIndex: Math.max(0, Math.min(normalizedPanel.activeTabIndex, nextTabs.length - 1)),
        });
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (normalizedPanel.activeTabIndex + direction + normalizedPanel.tabs.length) % normalizedPanel.tabs.length;
        onPanelStateChange({
          ...normalizedPanel,
          activeTabIndex: nextIndex,
        });
        return;
      }

      if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const nextIndex = (normalizedPanel.activeTabIndex + direction + normalizedPanel.tabs.length) % normalizedPanel.tabs.length;
        onPanelStateChange({
          ...normalizedPanel,
          activeTabIndex: nextIndex,
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [normalizedPanel, onPanelStateChange]);

  const persistContent = useCallback((tab, content) => {
    const requestEpoch = workspaceEpochRef.current;
    setNoteCache((current) => ({
      ...current,
      [getTabKey(tab)]: {
        ...(current[getTabKey(tab)] || {}),
        saveState: 'saving',
      },
    }));

    fetch(getSaveEndpoint(tab), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getWorkspaceHeaders(workspaceId),
      },
      body: JSON.stringify({ content }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to save note');
        return response.json();
      })
      .then((payload) => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        if (tab.type === 'main') {
          onMainNoteContentChange?.(tab.itemId, String(content || '').trim().length > 0);
        }
        setNoteCache((current) => ({
          ...current,
          [getTabKey(tab)]: {
            ...(current[getTabKey(tab)] || {}),
            status: 'ready',
            content,
            filename: payload.filename || tab.filename,
            workspacePath: payload.workspacePath || current[getTabKey(tab)]?.workspacePath || null,
            title: getTabTitle(tab, content),
            saveState: 'saved',
          },
        }));
        refreshAllNotes();
      })
      .catch(() => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        setNoteCache((current) => ({
          ...current,
          [getTabKey(tab)]: {
            ...(current[getTabKey(tab)] || {}),
            status: 'error',
            message: 'Autosave failed. Keep editing and try again in a moment.',
            saveState: 'error',
          },
        }));
      });
  }, [onMainNoteContentChange, refreshAllNotes, workspaceId]);

  const handleContentChange = useCallback((tab, content) => {
    const key = getTabKey(tab);

    setNoteCache((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        status: 'ready',
        content,
        title: getTabTitle(tab, content),
        saveState: 'dirty',
      },
    }));

    if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);
    saveTimersRef.current[key] = setTimeout(() => persistContent(tab, content), 500);
  }, [persistContent]);

  const handleTogglePanel = useCallback(() => {
    onPanelStateChange({
      ...normalizedPanel,
      open: !normalizedPanel.open,
    });
  }, [normalizedPanel, onPanelStateChange]);

  const handleResizeStart = useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = normalizedPanel.width;

    const onMouseMove = (moveEvent) => {
      const nextWidth = clampWidth(startWidth - (moveEvent.clientX - startX));
      onPanelStateChange({
        ...normalizedPanel,
        open: true,
        width: nextWidth,
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [normalizedPanel, onPanelStateChange]);

  const handleCloseTab = useCallback((index) => {
    const nextTabs = normalizedPanel.tabs.filter((_, currentIndex) => currentIndex !== index);
    onPanelStateChange({
      ...normalizedPanel,
      open: nextTabs.length > 0 ? normalizedPanel.open : false,
      tabs: nextTabs,
      activeTabIndex: Math.max(0, Math.min(normalizedPanel.activeTabIndex - (index <= normalizedPanel.activeTabIndex ? 1 : 0), nextTabs.length - 1)),
    });
  }, [normalizedPanel, onPanelStateChange]);

  const handlePinTab = useCallback((index) => {
    onPanelStateChange({
      ...normalizedPanel,
      tabs: normalizedPanel.tabs.map((tab, tabIndex) => (
        tabIndex === index ? { ...tab, pinned: true } : tab
      )),
      activeTabIndex: index,
    });
  }, [normalizedPanel, onPanelStateChange]);

  const handleReorderTabs = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex || fromIndex == null || toIndex == null) return;

    const nextTabs = [...normalizedPanel.tabs];
    const [movedTab] = nextTabs.splice(fromIndex, 1);
    nextTabs.splice(toIndex, 0, movedTab);

    let activeTabIndex = normalizedPanel.activeTabIndex;
    if (activeTabIndex === fromIndex) {
      activeTabIndex = toIndex;
    } else if (fromIndex < activeTabIndex && toIndex >= activeTabIndex) {
      activeTabIndex -= 1;
    } else if (fromIndex > activeTabIndex && toIndex <= activeTabIndex) {
      activeTabIndex += 1;
    }

    onPanelStateChange({
      ...normalizedPanel,
      tabs: nextTabs,
      activeTabIndex,
    });
  }, [normalizedPanel, onPanelStateChange]);

  const handleNavigateLink = useCallback((tab, linkText, options = {}) => {
    const requestEpoch = workspaceEpochRef.current;
    fetch(`/api/notes/resolve?fromItemId=${encodeURIComponent(tab.itemId)}&link=${encodeURIComponent(linkText)}`, {
      headers: getWorkspaceHeaders(workspaceId),
    })
      .then(async (response) => {
        if (response.ok) return response.json();
        throw new Error('missing');
      })
      .then((resolved) => {
        if (requestEpoch !== workspaceEpochRef.current) return;
        const currentEntry = toHistoryEntry(tab);
        if (!options.newTab && currentEntry) {
          setNavigation((current) => ({
            backStack: [...current.backStack, currentEntry],
            forwardStack: [],
          }));
        }
        onOpenNote(resolved.itemId, {
          filename: resolved.filename,
          type: resolved.type,
          replaceActive: !options.newTab,
        });
      })
      .catch(() => {});
  }, [onOpenNote, workspaceId]);

  const handleNavigateHistory = useCallback((direction) => {
    if (!activeTab) return;
    if (direction === 'back') {
      if (navigation.backStack.length === 0) return;
      const target = navigation.backStack[navigation.backStack.length - 1];
      const currentEntry = toHistoryEntry(activeTab);
      onOpenNote(target.itemId, { filename: target.filename, type: target.type, replaceActive: true });
      setNavigation({
        backStack: navigation.backStack.slice(0, -1),
        forwardStack: currentEntry ? [...navigation.forwardStack, currentEntry] : navigation.forwardStack,
      });
      return;
    }

    if (navigation.forwardStack.length === 0) return;
    const target = navigation.forwardStack[navigation.forwardStack.length - 1];
    const currentEntry = toHistoryEntry(activeTab);
    onOpenNote(target.itemId, { filename: target.filename, type: target.type, replaceActive: true });
    setNavigation({
      backStack: currentEntry ? [...navigation.backStack, currentEntry] : navigation.backStack,
      forwardStack: navigation.forwardStack.slice(0, -1),
    });
  }, [activeTab, navigation, onOpenNote]);

  const handleCreateRelatedNote = useCallback((proposedName = newRelatedName) => {
    if (!activeTab) return;
    const proposed = proposedName.trim();
    if (!proposed) return;

    fetch(`/api/notes/${activeTab.itemId}/related`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getWorkspaceHeaders(workspaceId),
      },
      body: JSON.stringify({ filename: proposed }),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to create note');
        return response.json();
      })
      .then((created) => {
        setRelatedNotes((current) => current.includes(created.filename) ? current : [...current, created.filename].sort());
        setNewRelatedName('');
        setNoteCache((current) => ({
          ...current,
          [getTabKey({ itemId: created.itemId, filename: created.filename, type: created.type })]: {
            ...(current[getTabKey({ itemId: created.itemId, filename: created.filename, type: created.type })] || {}),
            workspacePath: created.workspacePath || null,
          },
        }));
        onOpenNote(created.itemId, { filename: created.filename, type: created.type });
        refreshAllNotes();
      })
      .catch(() => {});
  }, [activeTab, newRelatedName, onOpenNote, refreshAllNotes, workspaceId]);

  const handleConfirmDeleteRelatedNote = useCallback(() => {
    if (!deleteTarget) return;

    setDeletingRelatedNote(true);
    const endpoint = deleteTarget.type === 'main'
      ? `/api/notes/${deleteTarget.itemId}`
      : `/api/notes/${deleteTarget.itemId}/related/${encodeURIComponent(deleteTarget.filename)}`;

    fetch(endpoint, {
      method: 'DELETE',
      headers: getWorkspaceHeaders(workspaceId),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Failed to delete related note');
        return response.json();
      })
      .then(() => {
        const deletedTabKey = getTabKey(deleteTarget);
        if (deleteTarget.type === 'main') {
          onMainNoteContentChange?.(deleteTarget.itemId, false);
        } else {
          setRelatedNotes((current) => current.filter((filename) => filename !== deleteTarget.filename));
        }
        setNoteCache((current) => {
          const next = { ...current };
          delete next[deletedTabKey];
          return next;
        });
        setNavigation((current) => ({
          backStack: current.backStack.filter((entry) => getTabKey(entry) !== deletedTabKey),
          forwardStack: current.forwardStack.filter((entry) => getTabKey(entry) !== deletedTabKey),
        }));
        onPanelStateChange((currentPanel) => {
          const current = {
            open: !!currentPanel?.open,
            width: currentPanel?.width,
            tabs: Array.isArray(currentPanel?.tabs)
              ? currentPanel.tabs.map((tab) => ({ ...tab, pinned: tab?.pinned !== false }))
              : [],
            activeTabIndex: Number.isInteger(currentPanel?.activeTabIndex) ? currentPanel.activeTabIndex : 0,
          };
          const removedIndex = current.tabs.findIndex((tab) => getTabKey(tab) === deletedTabKey);
          if (removedIndex === -1) return current;
          const nextTabs = current.tabs.filter((tab) => getTabKey(tab) !== deletedTabKey);
          const nextActiveIndex = Math.max(
            0,
            Math.min(current.activeTabIndex - (removedIndex <= current.activeTabIndex ? 1 : 0), nextTabs.length - 1),
          );
          return {
            ...current,
            open: nextTabs.length > 0,
            tabs: nextTabs,
            activeTabIndex: nextTabs.length > 0 ? nextActiveIndex : 0,
          };
        });
        setDeleteTarget(null);
        setTabContextMenu(null);
        refreshAllNotes();
      })
      .catch(() => {})
      .finally(() => {
        setDeletingRelatedNote(false);
      });
  }, [deleteTarget, onPanelStateChange, refreshAllNotes, workspaceId]);

  const handleTabContextMenu = useCallback((event, tab, index, tabMeta, cacheEntry) => {
    event.preventDefault();
    setTabContextMenu({
      x: event.clientX,
      y: event.clientY,
      index,
      tab,
      label: getVisibleTabLabel(tab, tabMeta, cacheEntry),
    });
  }, []);

  const buildTabContextMenuItems = useCallback(() => {
    if (!tabContextMenu) return [];
    const items = [];
    if (normalizedPanel.activeTabIndex !== tabContextMenu.index) {
      items.push({
        label: 'Show note',
        action: () => onPanelStateChange({ ...normalizedPanel, activeTabIndex: tabContextMenu.index }),
      });
    }
    if (tabContextMenu.tab.pinned === false) {
      items.push({
        label: 'Pin tab',
        action: () => handlePinTab(tabContextMenu.index),
      });
    }
    items.push({
      label: 'Close tab',
      action: () => handleCloseTab(tabContextMenu.index),
    });
    items.push({ separator: true });
    items.push({
      label: `Delete "${tabContextMenu.label}"`,
      danger: true,
      action: () => setDeleteTarget({
        itemId: tabContextMenu.tab.itemId,
        filename: tabContextMenu.tab.filename,
        type: tabContextMenu.tab.type,
        label: tabContextMenu.label,
      }),
    });
    return items;
  }, [handleCloseTab, handlePinTab, normalizedPanel, onPanelStateChange, tabContextMenu]);

  const activeMainFilename = activeTab?.itemId
    ? (allNotes.find((note) => note.itemId === activeTab.itemId && note.type === 'main')?.filename || 'main.md')
    : null;

  if (!normalizedPanel.open) {
    return (
      <aside className="note-panel note-panel-collapsed" aria-label="Notes panel">
        <button
          className="note-panel-toggle"
          type="button"
          onClick={handleTogglePanel}
          title="Open notes panel"
        >
          {'[>]'}
        </button>
      </aside>
    );
  }

  return (
    <aside className="note-panel" style={{ width: normalizedPanel.width }}>
      <div className="note-panel-resizer" onMouseDown={handleResizeStart} title="Drag to resize" />
      <div className="note-panel-header">
        <div className="note-panel-tabs" role="tablist" aria-label="Open notes">
          {normalizedPanel.tabs.map((tab, index) => {
            const key = getTabKey(tab);
            const cacheEntry = noteCache[key];
            const tabMeta = itemMeta?.[tab.itemId] || null;
            return (
              <div
                key={key}
                className={`note-panel-tab-button${index === normalizedPanel.activeTabIndex ? ' active' : ''}${tab.pinned === false ? ' preview' : ''}${draggedTabIndex === index ? ' dragging' : ''}`}
                title={tab.filename}
                style={{ '--note-accent': tabMeta?.color || 'var(--accent)' }}
                draggable
                onContextMenu={(event) => handleTabContextMenu(event, tab, index, tabMeta, cacheEntry)}
                onDragStart={(event) => {
                  setDraggedTabIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }}
                onDragEnd={() => setDraggedTabIndex(null)}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (draggedTabIndex == null || draggedTabIndex === index) return;
                  handleReorderTabs(draggedTabIndex, index);
                  setDraggedTabIndex(index);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggedTabIndex(null);
                }}
              >
                <button
                  className="note-panel-tab-select"
                  type="button"
                  onClick={() => onPanelStateChange({ ...normalizedPanel, activeTabIndex: index })}
                  onDoubleClick={() => handlePinTab(index)}
                >
                  <span className="note-panel-tab-label">{getVisibleTabLabel(tab, tabMeta, cacheEntry)}</span>
                </button>
                <button
                  className="note-panel-tab-close"
                  type="button"
                  onClick={() => handleCloseTab(index)}
                  aria-label={`Close ${tab.filename}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        {activeCacheEntry?.saveState && (
          <span className={`note-save-indicator ${activeCacheEntry.saveState}`}>
            {activeCacheEntry.saveState === 'saving' && 'Saving…'}
            {activeCacheEntry.saveState === 'saved' && 'Saved'}
            {activeCacheEntry.saveState === 'dirty' && 'Autosave queued'}
            {activeCacheEntry.saveState === 'error' && 'Save failed'}
          </span>
        )}
        <div className="note-panel-nav-actions">
          <button
            className="note-panel-nav-button"
            type="button"
            onClick={() => handleNavigateHistory('back')}
            disabled={!canNavigateBack}
            title="Back to previous followed note"
          >
            ←
          </button>
          <button
            className="note-panel-nav-button"
            type="button"
            onClick={() => handleNavigateHistory('forward')}
            disabled={!canNavigateForward}
            title="Forward to next followed note"
          >
            →
          </button>
        </div>
        <button
          className="note-panel-toggle"
          type="button"
          onClick={handleTogglePanel}
          title="Collapse notes panel (Esc)"
        >
          {'[<]'}
        </button>
      </div>

      {activeTab ? (
        <>
          <NotePanelTab
            tab={activeTab}
            cacheEntry={noteCache[getTabKey(activeTab)]}
            itemMeta={activeItemMeta}
            allNotes={allNotes}
            theme={theme}
            onContentChange={(content) => handleContentChange(activeTab, content)}
            onNavigateLink={(linkText, options) => handleNavigateLink(activeTab, linkText, options)}
          />
          <div className="note-panel-related">
            <div className="note-panel-related-header">
              <span>Related notes</span>
            </div>
            <div className="note-panel-related-actions">
              {activeTab.type === 'related' && activeMainFilename && (
                <button
                  className="note-panel-related-item note-panel-related-item-main"
                  type="button"
                  onClick={() => onOpenNote(activeTab.itemId, { filename: activeMainFilename, type: 'main' })}
                  title="Open main note"
                >
                  Main note
                </button>
              )}
              <input
                className="note-panel-related-input"
                type="text"
                value={newRelatedName}
                onChange={(event) => setNewRelatedName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreateRelatedNote();
                  }
                }}
                placeholder="new-related-note"
              />
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={() => handleCreateRelatedNote()}
                title="Create related note"
              >
                New related
              </button>
            </div>
            {relatedNotes.length > 0 ? (
              <div className="note-panel-related-list">
                {relatedNotes.map((filename) => (
                  <button
                    key={filename}
                    className="note-panel-related-item"
                    type="button"
                    onClick={() => onOpenNote(activeTab.itemId, { filename, type: 'related' })}
                  >
                    {filename.replace(/\.md$/i, '')}
                  </button>
                ))}
              </div>
            ) : relatedNotesLoading ? (
              <p className="note-panel-related-empty">Loading related notes…</p>
            ) : (
              <p className="note-panel-related-empty">No related notes yet.</p>
            )}
          </div>
        </>
      ) : (
        <div className="note-panel-empty">
          <p>Click a task to preview its note, or use “Show Note” to open one here.</p>
        </div>
      )}
      <DeleteNoteModal
        target={deleteTarget}
        deleting={deletingRelatedNote}
        onConfirm={handleConfirmDeleteRelatedNote}
        onClose={() => {
          if (deletingRelatedNote) return;
          setDeleteTarget(null);
        }}
      />
      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          items={buildTabContextMenuItems()}
          onClose={() => setTabContextMenu(null)}
        />
      )}
    </aside>
  );
}

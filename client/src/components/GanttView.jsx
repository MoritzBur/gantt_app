import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import ContextMenu from './ContextMenu.jsx';

// ─── Date helpers ───────────────────────────────────────────────────────────

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function diffDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((b - a) / msPerDay);
}

// ─── Duration breakdown ─────────────────────────────────────────────────────

function calcTaskDays(startStr, endStr, activeCalEventIds, calendarEvents) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const total = diffDays(start, end) + 1;

  const weekendSet = new Set();
  const calSet = new Set();

  let cursor = new Date(start);
  while (cursor <= end) {
    const ds = formatDate(cursor);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) weekendSet.add(ds);
    cursor = addDays(cursor, 1);
  }

  for (const evId of activeCalEventIds) {
    const ev = calendarEvents.find(e => e.id === evId);
    if (!ev) continue;
    const evStart = parseDate(ev.start);
    const evEnd = parseDate(ev.end || ev.start);
    cursor = new Date(evStart);
    while (cursor <= evEnd) {
      if (cursor >= start && cursor <= end) calSet.add(formatDate(cursor));
      cursor = addDays(cursor, 1);
    }
  }

  const work = total - weekendSet.size;
  const allBlocked = new Set([...weekendSet, ...calSet]);
  const net = total - allBlocked.size;
  return { total, work, net };
}

// ─── Numbering / labeling ───────────────────────────────────────────────────

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

function formatShortDate(str) {
  const d = parseDate(str);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Color inheritance ──────────────────────────────────────────────────────

function resolveColor(node, parentColor) {
  return node.color || parentColor || '#4A90D9';
}

// ─── Zoom levels ────────────────────────────────────────────────────────────

const ZOOM_LEVELS = {
  Day:     { dayWidth: 40 },
  Week:    { dayWidth: 20 },
  Month:   { dayWidth: 8  },
  Quarter: { dayWidth: 4  },
};

// ─── Timeline header ────────────────────────────────────────────────────────

function TimelineHeader({ startDate, totalDays, dayWidth, zoom }) {
  const months = [];
  let cursor = new Date(startDate);

  while (cursor < addDays(startDate, totalDays)) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const visStart = cursor > monthStart ? cursor : monthStart;
    const visEnd = monthEnd < addDays(startDate, totalDays) ? monthEnd : addDays(startDate, totalDays - 1);
    const days = diffDays(visStart, visEnd) + 1;
    months.push({ label: cursor.toLocaleString('default', { month: 'short', year: 'numeric' }), days });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return (
    <div className="timeline-header">
      <div className="timeline-header-months">
        {months.map((m, i) => (
          <div key={i} className="timeline-month-label" style={{ width: m.days * dayWidth }}>
            {m.label}
          </div>
        ))}
      </div>
      {zoom === 'Day' && (
        <div className="timeline-header-days">
          {Array.from({ length: totalDays }, (_, i) => {
            const d = addDays(startDate, i);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={i} className={`timeline-day-label ${isWeekend ? 'weekend' : ''}`} style={{ width: dayWidth }}>
                {d.getDate()}
              </div>
            );
          })}
        </div>
      )}
      {zoom === 'Week' && (
        <div className="timeline-header-days">
          {Array.from({ length: totalDays }, (_, i) => {
            const d = addDays(startDate, i);
            if (d.getDay() !== 1) return <div key={i} style={{ width: dayWidth, display: 'inline-block' }} />;
            return (
              <div key={i} className="timeline-week-label" style={{ width: dayWidth * 7 }}>
                W{getWeekNumber(d)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── Contrast text color ────────────────────────────────────────────────────

function getContrastColor(bgColor) {
  if (!bgColor || !bgColor.startsWith('#')) return 'rgba(255,255,255,0.92)';
  const hex = bgColor.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const toLinear = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)';
}

function rgbaFromHex(hexColor, alpha) {
  if (!hexColor || !hexColor.startsWith('#') || hexColor.length !== 7) {
    return `rgba(100, 160, 220, ${alpha})`;
  }
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Gantt bar ──────────────────────────────────────────────────────────────

function GanttBar({ startDate, taskStart, taskEnd, dayWidth, color, isReadOnly, isLocked, isDone, label, barHeight, labelOutside, isActive, workDays, netDays, hasNotes, onDragStart, onDragCommit, onClick, onDoubleClick }) {
  const didDragRef = useRef(false);
  const labelRef = useRef(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [labelFits, setLabelFits] = useState(true);
  const displayStart = dragState?.newStart || taskStart;
  const displayEnd = dragState?.newEnd || taskEnd;
  const startOffset = diffDays(startDate, parseDate(displayStart));
  const duration = diffDays(parseDate(displayStart), parseDate(displayEnd)) + 1;
  const left = startOffset * dayWidth;
  const width = Math.max(duration * dayWidth, dayWidth);

  useLayoutEffect(() => {
    if (!labelOutside || !labelRef.current) return;
    setLabelFits(labelRef.current.scrollWidth <= labelRef.current.clientWidth);
  }, [label, width, duration, labelOutside]);

  const handleMouseDown = useCallback((e, mode) => {
    if (isReadOnly || isLocked) return;
    e.preventDefault();
    e.stopPropagation();

    didDragRef.current = false;
    const startX = e.clientX;
    const origStart = taskStart;
    const origEnd = taskEnd;
    let nextStart = origStart;
    let nextEnd = origEnd;

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const daysDelta = Math.round(dx / dayWidth);
      if (daysDelta === 0) return;

      if (!didDragRef.current) {
        didDragRef.current = true;
        onDragStart?.();
      }

      let newStart = origStart;
      let newEnd = origEnd;

      if (mode === 'move') {
        newStart = formatDate(addDays(parseDate(origStart), daysDelta));
        newEnd = formatDate(addDays(parseDate(origEnd), daysDelta));
      } else if (mode === 'resize-left') {
        newStart = formatDate(addDays(parseDate(origStart), daysDelta));
        if (newStart > newEnd) newStart = newEnd;
      } else if (mode === 'resize-right') {
        newEnd = formatDate(addDays(parseDate(origEnd), daysDelta));
        if (newEnd < newStart) newEnd = newStart;
      }

      nextStart = newStart;
      nextEnd = newEnd;
      setDragState({ mode, newStart, newEnd });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragState(null);
      if (didDragRef.current) onDragCommit?.(nextStart, nextEnd);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [dayWidth, isLocked, isReadOnly, onDragCommit, onDragStart, taskEnd, taskStart]);

  const showLeftDate = dragState && (dragState.mode === 'resize-left' || dragState.mode === 'move');
  const showRightDate = dragState && (dragState.mode === 'resize-right' || dragState.mode === 'move');
  const noDrag = isReadOnly || isLocked;
  const liveDuration = duration;

  return (
    <div
      className={`gantt-bar ${isReadOnly ? 'readonly' : ''} ${isDone ? 'done' : ''} ${isActive ? 'active' : ''} ${hasNotes ? 'has-notes' : ''}`}
      style={{ left, width, backgroundColor: color, zIndex: dragState ? 1000 : tooltipVisible ? 1000 : 2, height: barHeight }}
      onClick={(e) => { e.stopPropagation(); if (!didDragRef.current && onClick) onClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (onDoubleClick) onDoubleClick(); }}
    >
      {showLeftDate && <div className="drag-date-label drag-date-left">{formatShortDate(dragState.newStart)}</div>}
      {!noDrag && <div className="gantt-bar-handle left" onMouseDown={(e) => handleMouseDown(e, 'resize-left')} />}
      <div
        className="gantt-bar-inner"
        onMouseDown={(e) => handleMouseDown(e, 'move')}
        style={{ cursor: noDrag ? 'default' : 'grab' }}
      >
        {label && (
          <span
            ref={labelRef}
            className="gantt-bar-label"
            style={{
              color: getContrastColor(color),
              visibility: (labelOutside && !labelFits) ? 'hidden' : 'visible',
            }}
          >{label}{!labelOutside && <span className="gantt-bar-duration"> ({duration}d{workDays != null && workDays !== duration ? <span className="dur-work"> {workDays}d</span> : null}{netDays != null && netDays !== (workDays ?? duration) ? <span className="dur-net"> {netDays}d</span> : null})</span>}</span>
        )}
      </div>
      {!noDrag && <div className="gantt-bar-handle right" onMouseDown={(e) => handleMouseDown(e, 'resize-right')} />}
      {showRightDate && <div className="drag-date-label drag-date-right">{formatShortDate(dragState.newEnd)}</div>}
      {labelOutside && label && (
        <div className="gantt-bar-outside-label" style={{ left: showRightDate ? 'calc(100% + 95px)' : 'calc(100% + 8px)' }}>
          {!labelFits && <>{label} </>}<span className="gantt-bar-duration">({liveDuration}d{workDays != null && workDays !== liveDuration ? <span className="dur-work"> {workDays}d</span> : null}{netDays != null && netDays !== (workDays ?? liveDuration) ? <span className="dur-net"> {netDays}d</span> : null})</span>
        </div>
      )}
      {tooltipVisible && label && !labelOutside && <div className="gantt-bar-tooltip">{label}</div>}
    </div>
  );
}

// ─── Milestone marker ───────────────────────────────────────────────────────

function MilestoneMarker({ startDate, taskDate, dayWidth, color, isDone, isReadOnly, label, diamondPx, onDragStart, onDragCommit, onClick }) {
  const [dragDate, setDragDate] = useState(null);
  const displayDate = dragDate || taskDate;
  const offset = diffDays(startDate, parseDate(displayDate));
  const left = offset * dayWidth + dayWidth / 2 - diamondPx / 2;
  const didDragRef = useRef(false);

  const handleMouseDown = useCallback((e) => {
    if (isReadOnly) return;
    e.preventDefault();
    e.stopPropagation();
    didDragRef.current = false;
    const startX = e.clientX;
    const origDate = taskDate;
    let nextDate = origDate;

    const onMouseMove = (ev) => {
      const daysDelta = Math.round((ev.clientX - startX) / dayWidth);
      if (daysDelta === 0) return;
      if (!didDragRef.current) {
        didDragRef.current = true;
        onDragStart?.();
      }
      const newDate = formatDate(addDays(parseDate(origDate), daysDelta));
      nextDate = newDate;
      setDragDate(newDate);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragDate(null);
      if (didDragRef.current) onDragCommit?.(nextDate, nextDate);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [dayWidth, isReadOnly, onDragCommit, onDragStart, taskDate]);

  return (
    <div
      className={`milestone-marker ${isDone ? 'done' : ''}`}
      style={{ left, cursor: isReadOnly ? 'default' : 'grab' }}
      onMouseDown={handleMouseDown}
      onClick={(e) => { e.stopPropagation(); if (!didDragRef.current && onClick) onClick(); }}
    >
      <div className="milestone-diamond" style={{ backgroundColor: color, width: diamondPx, height: diamondPx }} />
      <span className="milestone-label">{label}</span>
    </div>
  );
}

// ─── Today line ─────────────────────────────────────────────────────────────

function TodayLine({ startDate, dayWidth, totalDays }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = diffDays(startDate, today);
  if (offset < 0 || offset >= totalDays) return null;
  return <div className="today-line" style={{ left: offset * dayWidth + dayWidth / 2 }} />;
}

// ─── Recursive row building ─────────────────────────────────────────────────

const MAX_UI_DEPTH = 5;

function buildRows(items, collapsed, parentColor, numberPath = [], depth = 0) {
  const rows = [];
  items.forEach((node, index) => {
    const currentPath = [...numberPath, index + 1];
    const color = resolveColor(node, parentColor);
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = !!collapsed[node.id];

    if (node.type === 'group') {
      rows.push({
        key: node.id,
        rowType: 'group',
        node,
        depth,
        numberPath: currentPath,
        color,
        childCount: node.children ? node.children.length : 0,
      });
      if (!isCollapsed) {
        if (node.children) {
          rows.push(...buildRows(node.children, collapsed, color, currentPath, depth + 1));
        }
        // "Add child" button — only if depth allows
        if (depth + 1 < MAX_UI_DEPTH) {
          rows.push({
            key: `add-child-${node.id}`,
            rowType: 'add-child',
            parentId: node.id,
            depth: depth + 1,
            color,
          });
        }
      }
    } else {
      rows.push({
        key: node.id,
        rowType: 'task',
        node,
        depth,
        numberPath: currentPath,
        color,
      });
    }
  });
  return rows;
}

/** Collect all dates from the tree for timeline range */
function collectTreeDates(items) {
  const dates = [];
  for (const item of items) {
    if (item.start) dates.push(item.start);
    if (item.end) dates.push(item.end);
    if (item.children) dates.push(...collectTreeDates(item.children));
  }
  return dates;
}

// ─── Main GanttView ─────────────────────────────────────────────────────────

export default function GanttView({
  data,
  uiState,
  calendarEvents,
  calendarConnected,
  onCalendarSetup,
  onNodeClick,
  onAddChild,
  onNodeUpdate,
  onDeleteNode,
  onSplitNode,
  onSaveStatus,
  onReorder,
  onUiStateChange,
  readonly = false,
}) {
  const [zoom, setZoom] = useState(uiState?.zoom && ZOOM_LEVELS[uiState.zoom] ? uiState.zoom : 'Month');
  const [collapsed, setCollapsed] = useState(uiState?.collapsed || {});
  const [density, setDensity] = useState(uiState?.density === 'Compact' ? 'Compact' : 'Regular');
  const [dropIndicator, setDropIndicatorState] = useState(null);
  const [draggingItem, setDraggingItem] = useState(null);
  const [activeCalEvents, setActiveCalEvents] = useState(() => new Set(Array.isArray(uiState?.activeCalEvents) ? uiState.activeCalEvents : []));
  const [listWidth, setListWidth] = useState(Number.isFinite(uiState?.listWidth) ? uiState.listWidth : 260);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, nodeId, nodeType, depth }

  const timelineRef = useRef(null);
  const dragRef = useRef(null);
  const dropIndicatorRef = useRef(null);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    if (!uiState) return;
    if (uiState.zoom && uiState.zoom !== zoom && ZOOM_LEVELS[uiState.zoom]) setZoom(uiState.zoom);
    if (uiState.density && uiState.density !== density) setDensity(uiState.density === 'Compact' ? 'Compact' : 'Regular');
    if (uiState.collapsed && JSON.stringify(uiState.collapsed) !== JSON.stringify(collapsed)) setCollapsed(uiState.collapsed);
    const nextActive = Array.isArray(uiState.activeCalEvents) ? uiState.activeCalEvents : [];
    if (JSON.stringify([...activeCalEvents]) !== JSON.stringify(nextActive)) {
      setActiveCalEvents(new Set(nextActive));
    }
    if (Number.isFinite(uiState.listWidth) && uiState.listWidth !== listWidth) setListWidth(uiState.listWidth);
  }, [uiState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onUiStateChange) return;
    onUiStateChange({
      zoom,
      density,
      collapsed,
      activeCalEvents: [...activeCalEvents],
      listWidth,
    });
  }, [zoom, density, collapsed, activeCalEvents, listWidth, onUiStateChange]);

  const { dayWidth } = ZOOM_LEVELS[zoom];

  const items = data.items || [];
  const allDates = [
    ...collectTreeDates(items),
    ...calendarEvents.flatMap(e => [e.start, e.end || e.start]),
  ].filter(Boolean).sort();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rangeStart = allDates.length > 0 ? parseDate(allDates[0]) : new Date(today.getFullYear(), today.getMonth(), 1);
  let rangeEnd = allDates.length > 0 ? parseDate(allDates[allDates.length - 1]) : addDays(today, 90);
  rangeStart = addDays(rangeStart, -14);
  rangeEnd = addDays(rangeEnd, 30);
  rangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  rangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 1, 0);

  const totalDays = diffDays(rangeStart, rangeEnd) + 1;
  const totalWidth = totalDays * dayWidth;

  const toggleCollapse = (nodeId) => {
    setCollapsed(prev => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const handleNodeDrag = useCallback(async (nodeId, newStart, newEnd) => {
    onNodeUpdate(nodeId, { start: newStart, end: newEnd });
  }, [onNodeUpdate]);

  // ─── List resize ──────────────────────────────────────────────────────────

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;

    const onMouseMove = (mv) => {
      const newWidth = Math.max(160, Math.min(520, startWidth + mv.clientX - startX));
      setListWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [listWidth]);

  // ─── List drag-to-reorder ─────────────────────────────────────────────────

  const setDropIndicator = useCallback((val) => {
    dropIndicatorRef.current = val;
    setDropIndicatorState(val);
  }, []);

  const startListDrag = useCallback((e, nodeId, parentId) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { nodeId, parentId };
    setDraggingItem({ nodeId });
    document.body.style.cursor = 'grabbing';

    const onMouseMove = (mv) => {
      const el = document.elementFromPoint(mv.clientX, mv.clientY);
      if (!el) return;
      const rowEl = el.closest('[data-row-id]');
      if (!rowEl) return;

      const rowId = rowEl.dataset.rowId;
      const rowParentId = rowEl.dataset.parentId || null;
      const rect = rowEl.getBoundingClientRect();
      const isTopHalf = mv.clientY < rect.top + rect.height / 2;
      const drag = dragRef.current;
      if (!drag || drag.parentId !== rowParentId) return; // only reorder within same parent

      if (isTopHalf) {
        setDropIndicator({ parentId: rowParentId, insertBeforeId: rowId });
      } else {
        // Find next sibling
        const d = dataRef.current;
        const parentItems = rowParentId ? findNodeById(d.items, rowParentId)?.children : d.items;
        if (!parentItems) return;
        const idx = parentItems.findIndex(n => n.id === rowId);
        const next = parentItems[idx + 1];
        setDropIndicator({ parentId: rowParentId, insertBeforeId: next ? next.id : null });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';

      const drag = dragRef.current;
      const indicator = dropIndicatorRef.current;

      if (drag && indicator && drag.parentId === indicator.parentId) {
        const d = dataRef.current;
        const parentItems = drag.parentId ? findNodeById(d.items, drag.parentId)?.children : d.items;
        if (parentItems) {
          const ids = parentItems.map(n => n.id);
          const fromIdx = ids.indexOf(drag.nodeId);
          if (fromIdx !== -1) {
            ids.splice(fromIdx, 1);
            if (indicator.insertBeforeId === null) {
              ids.push(drag.nodeId);
            } else {
              const toIdx = ids.indexOf(indicator.insertBeforeId);
              ids.splice(toIdx >= 0 ? toIdx : ids.length, 0, drag.nodeId);
            }
            onReorder(drag.parentId, ids);
          }
        }
      }

      dragRef.current = null;
      setDraggingItem(null);
      setDropIndicator(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onReorder, setDropIndicator]);

  // ─── Context menu ─────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e, node, depth) => {
    if (readonly) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node, depth });
  }, [readonly]);

  const buildContextMenuItems = useCallback(() => {
    if (!contextMenu) return [];
    const { node, depth } = contextMenu;
    const items = [];

    if (node.type === 'group') {
      items.push({ label: 'Add task', action: () => onAddChild(node.id, 'task') });
      if (depth < MAX_UI_DEPTH - 1) {
        items.push({ label: 'Add sub-group', action: () => onAddChild(node.id, 'group') });
      }
      items.push({ separator: true });
      items.push({ label: 'Edit', action: () => onNodeClick(node.id) });
      items.push({ label: 'Delete', action: () => onDeleteNode(node.id), danger: true });
    } else {
      // task
      if (depth < MAX_UI_DEPTH - 1) {
        items.push({ label: 'Split into subtasks', action: () => onSplitNode(node.id) });
        items.push({ separator: true });
      }
      items.push({
        label: node.done ? 'Mark as not done' : 'Mark as done',
        action: () => onNodeUpdate(node.id, { done: !node.done }),
      });
      items.push({ label: 'Edit', action: () => onNodeClick(node.id) });
      items.push({ label: 'Delete', action: () => onDeleteNode(node.id), danger: true });
    }

    return items;
  }, [contextMenu, onAddChild, onNodeClick, onNodeUpdate, onDeleteNode, onSplitNode]);

  // Scroll to today on mount
  useEffect(() => {
    if (timelineRef.current) {
      const todayOffset = diffDays(rangeStart, today) * dayWidth;
      const viewWidth = timelineRef.current.clientWidth;
      timelineRef.current.scrollLeft = Math.max(0, todayOffset - viewWidth / 2);
    }
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Build rows ───────────────────────────────────────────────────────────

  const rows = buildRows(items, collapsed, null);

  const DENSITY_LEVELS = { Regular: 40, Compact: 28 };
  const ROW_HEIGHT = DENSITY_LEVELS[density];
  const BASE_BAR_HEIGHT = density === 'Compact' ? 18 : 24;
  const BASE_DIAMOND_PX = density === 'Compact' ? 12 : 16;
  const INDENT_PX = 20;

  // Depth-based visual scaling
  const DEPTH_STEP_PX = 2;
  const depthBarHeight = (depth) => Math.max(BASE_BAR_HEIGHT - depth * DEPTH_STEP_PX, 12);
  const depthDiamondPx = (depth) => Math.max(BASE_DIAMOND_PX - depth * DEPTH_STEP_PX, 8);

  return (
    <div className="gantt-view">
      {/* Toolbar */}
      <div className="gantt-toolbar">
        <div className="zoom-controls">
          {Object.keys(ZOOM_LEVELS).map(level => (
            <button
              key={level}
              className={`btn btn-zoom ${zoom === level ? 'active' : ''}`}
              onClick={() => setZoom(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="density-controls">
          {Object.keys(DENSITY_LEVELS).map(d => (
            <button
              key={d}
              className={`btn btn-zoom ${density === d ? 'active' : ''}`}
              onClick={() => setDensity(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="gantt-body">
        {/* Left panel: task list */}
        <div className="gantt-list" style={{ width: listWidth, minWidth: listWidth }}>
          <div className="gantt-list-header">Tasks</div>

          {rows.map((row) => {
            if (row.rowType === 'group') {
              const isCollapsed = collapsed[row.node.id];
              const isDragging = draggingItem?.nodeId === row.node.id;
              const showIndicatorBefore =
                dropIndicator?.insertBeforeId === row.node.id &&
                draggingItem?.nodeId !== row.node.id;
              const label = getNodeLabel(row.node, row.numberPath);
              const parentId = row.depth === 0 ? null : findParentId(items, row.node.id);

              return (
                <React.Fragment key={row.key}>
                  {showIndicatorBefore && <div className="list-drop-indicator" />}
                  <div
                    data-row-id={row.node.id}
                    data-parent-id={parentId || ''}
                    className={`gantt-row gantt-phase-row${isDragging ? ' is-dragging' : ''}`}
                    style={{ height: ROW_HEIGHT, borderLeft: `3px solid ${row.color}`, paddingLeft: row.depth * INDENT_PX }}
                    onClick={() => !readonly && !draggingItem && onNodeClick(row.node.id)}
                    onContextMenu={(e) => handleContextMenu(e, row.node, row.depth)}
                  >
                    {!readonly && (
                      <div
                        className="drag-handle"
                        onMouseDown={(e) => startListDrag(e, row.node.id, parentId)}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to reorder"
                      >&#10303;</div>
                    )}
                    <button
                      className="collapse-btn"
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(row.node.id); }}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isCollapsed ? '\u25B6' : '\u25BC'}
                    </button>
                    <span className="phase-label" title={label}>
                      <span className="item-number">{(() => {
                        const p = getNodePrefix(row.node);
                        const num = getNodeNumber(row.numberPath);
                        return p ? `${p}\u00a0${num}` : num;
                      })()}</span>
                      <span className="item-name">{row.node.name}</span>
                    </span>
                    <span className="phase-task-count muted">({row.childCount})</span>
                  </div>
                </React.Fragment>
              );
            }

            if (row.rowType === 'task') {
              const isDragging = draggingItem?.nodeId === row.node.id;
              const showIndicatorBefore =
                dropIndicator?.insertBeforeId === row.node.id &&
                draggingItem?.nodeId !== row.node.id;
              const label = getNodeLabel(row.node, row.numberPath);
              const parentId = findParentId(items, row.node.id);

              return (
                <React.Fragment key={row.key}>
                  {showIndicatorBefore && <div className="list-drop-indicator list-drop-indicator--task" />}
                  <div
                    data-row-id={row.node.id}
                    data-parent-id={parentId || ''}
                    className={`gantt-row gantt-task-row${row.node.done ? ' done' : ''}${isDragging ? ' is-dragging' : ''}`}
                    style={{ height: ROW_HEIGHT, paddingLeft: row.depth * INDENT_PX }}
                    onClick={() => !readonly && !draggingItem && onNodeClick(row.node.id)}
                    onContextMenu={(e) => handleContextMenu(e, row.node, row.depth)}
                  >
                    <span className="task-indent" />
                    {!readonly && (
                      <div
                        className="drag-handle"
                        onMouseDown={(e) => startListDrag(e, row.node.id, parentId)}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to reorder"
                      >&#10303;</div>
                    )}
                    {row.node.milestone
                      ? <span className="task-milestone-dot" style={{ color: row.color }}>&#9670;</span>
                      : <span className="task-done-indicator" style={{ backgroundColor: row.color }} />
                    }
                    <span className="task-label" title={label}>
                      <span className="item-number">{getNodeNumber(row.numberPath)}</span>
                      <span className="item-name">
                        {row.node.done ? <s>{row.node.name}</s> : row.node.name}
                      </span>
                    </span>
                    <span className="task-dates muted">
                      {row.node.milestone ? row.node.start : `${row.node.start} – ${row.node.end}`}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            if (row.rowType === 'add-child') {
              if (readonly) return null;
              const showEndIndicator =
                dropIndicator?.parentId === row.parentId &&
                dropIndicator.insertBeforeId === null;
              const canAddGroup = row.depth < MAX_UI_DEPTH - 1;

              return (
                <React.Fragment key={row.key}>
                  {showEndIndicator && <div className="list-drop-indicator list-drop-indicator--task" />}
                  <div
                    className="gantt-row gantt-add-task-row"
                    style={{ height: ROW_HEIGHT, paddingLeft: row.depth * INDENT_PX }}
                  >
                    <span className="task-indent" />
                    <span className="add-task-btn" onClick={() => onAddChild(row.parentId, 'task')}>+ Task</span>
                    {canAddGroup && (
                      <span className="add-task-btn add-group-btn" onClick={() => onAddChild(row.parentId, 'group')}>+ Group</span>
                    )}
                  </div>
                </React.Fragment>
              );
            }

            return null;
          })}

          {/* Drop indicator after last top-level item */}
          {dropIndicator?.parentId === null && dropIndicator.insertBeforeId === null && draggingItem && (
            <div className="list-drop-indicator" />
          )}
        </div>

        {/* Resize handle */}
        <div className="gantt-list-resizer" onMouseDown={startResize} title="Drag to resize" />

        {/* Right panel: timeline */}
        <div className="gantt-timeline-wrap" ref={timelineRef}>
          <div className="gantt-timeline-inner" style={{ width: totalWidth }}>
            <TimelineHeader
              startDate={rangeStart}
              totalDays={totalDays}
              dayWidth={dayWidth}
              zoom={zoom}
            />

            <div className="gantt-grid" style={{ width: totalWidth }}>
              <TodayLine startDate={rangeStart} dayWidth={dayWidth} totalDays={totalDays} />

              {/* Active calendar event overlays */}
              {activeCalEvents.size > 0 && [...activeCalEvents].map(evId => {
                const ev = calendarEvents.find(e => e.id === evId);
                if (!ev) return null;
                const evEnd = ev.end || ev.start;
                const startOff = diffDays(rangeStart, parseDate(ev.start));
                const evDuration = diffDays(parseDate(ev.start), parseDate(evEnd)) + 1;
                return (
                  <div
                    key={`overlay-${evId}`}
                    className="cal-event-overlay"
                    style={{ left: startOff * dayWidth, width: Math.max(evDuration * dayWidth, dayWidth) }}
                  />
                );
              })}

              {zoom === 'Day' && Array.from({ length: totalDays }, (_, i) => {
                const d = addDays(rangeStart, i);
                if (d.getDay() !== 0 && d.getDay() !== 6) return null;
                return (
                  <div key={i} className="weekend-shade" style={{ left: i * dayWidth, width: dayWidth }} />
                );
              })}

              {rows.map((row) => {
                const rowStyle = { height: ROW_HEIGHT, position: 'relative' };

                if (row.rowType === 'group') {
                  const hasChildren = row.node.children && row.node.children.length > 0;
                  const pDays = row.node.start && row.node.end
                    ? calcTaskDays(row.node.start, row.node.end, activeCalEvents, calendarEvents)
                    : null;
                  return (
                    <div key={row.key} className="gantt-timeline-row" style={rowStyle}>
                      <GanttBar
                        startDate={rangeStart}
                        taskStart={row.node.start}
                        taskEnd={row.node.end}
                        dayWidth={dayWidth}
                        color={row.color}
                        isReadOnly={readonly}
                        isLocked={hasChildren}
                        isDone={false}
                        label={getNodeLabel(row.node, row.numberPath)}
                        barHeight={depthBarHeight(row.depth)}
                        labelOutside={true}
                        workDays={pDays?.work}
                        netDays={pDays?.net}
                        onDragCommit={(s, e) => handleNodeDrag(row.node.id, s, e)}
                        onClick={() => onNodeClick(row.node.id)}
                      />
                    </div>
                  );
                }

                if (row.rowType === 'task') {
                  const taskColor = row.node.done ? '#555' : row.color;
                  const taskLabel = getNodeLabel(row.node, row.numberPath);
                  const tDays = !row.node.milestone && row.node.start && row.node.end
                    ? calcTaskDays(row.node.start, row.node.end, activeCalEvents, calendarEvents)
                    : null;
                  return (
                    <div key={row.key} className="gantt-timeline-row" style={rowStyle}>
                      {row.node.milestone
                        ? <MilestoneMarker
                            startDate={rangeStart}
                            taskDate={row.node.start}
                            dayWidth={dayWidth}
                            color={taskColor}
                            isDone={row.node.done}
                            isReadOnly={readonly}
                            label={taskLabel}
                            diamondPx={depthDiamondPx(row.depth)}
                            onDragCommit={(s, e) => handleNodeDrag(row.node.id, s, e)}
                            onClick={() => !readonly && onNodeClick(row.node.id)}
                          />
                        : <GanttBar
                            startDate={rangeStart}
                            taskStart={row.node.start}
                            taskEnd={row.node.end}
                            dayWidth={dayWidth}
                            color={taskColor}
                            isReadOnly={readonly}
                            isDone={row.node.done}
                            label={taskLabel}
                            barHeight={depthBarHeight(row.depth)}
                            labelOutside={true}
                            workDays={tDays?.work}
                            netDays={tDays?.net}
                            hasNotes={!!row.node.notes}
                            onDragCommit={(s, e) => handleNodeDrag(row.node.id, s, e)}
                            onClick={() => onNodeClick(row.node.id)}
                          />
                      }
                    </div>
                  );
                }

                if (row.rowType === 'add-child') {
                  return <div key={row.key} className="gantt-timeline-row empty-row" style={rowStyle} />;
                }

                return <div key={row.key} className="gantt-timeline-row empty-row" style={rowStyle} />;
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && !readonly && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

// ─── Utility: find node by id in tree ───────────────────────────────────────

function findNodeById(items, id) {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findNodeById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Find the parentId of a node, or null if top-level */
function findParentId(items, id, parentId = null) {
  for (const item of items) {
    if (item.id === id) return parentId;
    if (item.children) {
      const found = findParentId(item.children, id, item.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

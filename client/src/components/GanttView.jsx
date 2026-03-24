import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';

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

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ─── Numbering helpers ────────────────────────────────────────────────────────

function getPhasePrefix(phase) {
  return phase.prefix !== undefined ? phase.prefix : 'WP';
}

function getPhaseLabel(phase, phaseIndex) {
  const prefix = getPhasePrefix(phase);
  return prefix ? `${prefix} ${phaseIndex + 1}\u2002${phase.name}` : `${phaseIndex + 1}\u2002${phase.name}`;
}

function getTaskLabel(task, phaseIndex, taskIndex) {
  return `${phaseIndex + 1}.${taskIndex + 1}\u2002${task.name}`;
}

function formatShortDate(str) {
  const d = parseDate(str);
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ─── Zoom levels ─────────────────────────────────────────────────────────────

const ZOOM_LEVELS = {
  Day:     { dayWidth: 40,  headerFormat: 'day' },
  Week:    { dayWidth: 20,  headerFormat: 'week' },
  Month:   { dayWidth: 8,   headerFormat: 'month' },
  Quarter: { dayWidth: 4,   headerFormat: 'month' },
};

// ─── Timeline header ─────────────────────────────────────────────────────────

function TimelineHeader({ startDate, totalDays, dayWidth, zoom }) {
  const months = [];
  let cursor = new Date(startDate);

  while (cursor < addDays(startDate, totalDays)) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const visStart = cursor > monthStart ? cursor : monthStart;
    const visEnd = monthEnd < addDays(startDate, totalDays) ? monthEnd : addDays(startDate, totalDays - 1);
    const days = diffDays(visStart, visEnd) + 1;
    months.push({ label: cursor.toLocaleString('default', { month: 'short', year: 'numeric' }), days, date: new Date(cursor) });
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

// ─── Contrast text color ─────────────────────────────────────────────────────

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

// ─── Calendar lane packing ────────────────────────────────────────────────────

function computeCalendarLanes(events) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const lanes = [];
  const laneEnds = [];

  for (const ev of sorted) {
    const evStart = ev.start;
    const evEnd = ev.end || ev.start;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (laneEnds[i] < evStart) {
        lanes[i].push(ev);
        laneEnds[i] = evEnd;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([ev]);
      laneEnds.push(evEnd);
    }
  }
  return lanes;
}

// ─── Gantt bar ────────────────────────────────────────────────────────────────

function GanttBar({ startDate, taskStart, taskEnd, dayWidth, color, isReadOnly, isLocked, isDone, label, barHeight, labelOutside, isActive, onDragUpdate, onClick, onDoubleClick }) {
  const startOffset = diffDays(startDate, parseDate(taskStart));
  const duration = diffDays(parseDate(taskStart), parseDate(taskEnd)) + 1;
  const left = startOffset * dayWidth;
  const width = Math.max(duration * dayWidth, dayWidth);

  const dragRef = useRef(null);
  const didDragRef = useRef(false);
  const labelRef = useRef(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [dragState, setDragState] = useState(null);
  const [labelFits, setLabelFits] = useState(true);

  // Re-measure whether the inside label fits whenever bar width, label, or duration changes
  useLayoutEffect(() => {
    if (!labelOutside || !labelRef.current) return;
    setLabelFits(labelRef.current.scrollWidth <= labelRef.current.clientWidth);
  }, [label, width, duration, labelOutside]);

  const handleLabelMouseEnter = () => {
    const el = labelRef.current;
    if (el && el.scrollWidth > el.clientWidth) setTooltipVisible(true);
  };
  const handleLabelMouseLeave = () => setTooltipVisible(false);

  const handleMouseDown = useCallback((e, mode) => {
    if (isReadOnly || isLocked) return;
    e.preventDefault();
    e.stopPropagation();

    didDragRef.current = false;
    const startX = e.clientX;
    const origStart = taskStart;
    const origEnd = taskEnd;

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const daysDelta = Math.round(dx / dayWidth);
      if (daysDelta === 0) return;

      didDragRef.current = true;
      let newStart = origStart;
      let newEnd = origEnd;

      if (mode === 'move') {
        newStart = formatDate(addDays(parseDate(origStart), daysDelta));
        newEnd = formatDate(addDays(parseDate(origEnd), daysDelta));
      } else if (mode === 'resize-left') {
        newStart = formatDate(addDays(parseDate(origStart), daysDelta));
        if (newStart >= newEnd) newStart = formatDate(addDays(parseDate(newEnd), -1));
      } else if (mode === 'resize-right') {
        newEnd = formatDate(addDays(parseDate(origEnd), daysDelta));
        if (newEnd <= newStart) newEnd = formatDate(addDays(parseDate(newStart), 1));
      }

      setDragState({ mode, newStart, newEnd });
      onDragUpdate(newStart, newEnd);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDragState(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [taskStart, taskEnd, dayWidth, isReadOnly, onDragUpdate]);

  const showLeftDate = dragState && (dragState.mode === 'resize-left' || dragState.mode === 'move');
  const showRightDate = dragState && (dragState.mode === 'resize-right' || dragState.mode === 'move');
  const noDrag = isReadOnly || isLocked;

  // For outside labels, live-update duration during drag
  const liveDuration = dragState
    ? diffDays(parseDate(dragState.newStart), parseDate(dragState.newEnd)) + 1
    : duration;

  return (
    <div
      className={`gantt-bar ${isReadOnly ? 'readonly' : ''} ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
      style={{ left, width, backgroundColor: color, zIndex: dragState ? 1000 : tooltipVisible ? 1000 : 2, height: barHeight }}
      onClick={(e) => { e.stopPropagation(); if (!didDragRef.current && onClick) onClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (onDoubleClick) onDoubleClick(); }}
    >
      {showLeftDate && (
        <div className="drag-date-label drag-date-left">{formatShortDate(dragState.newStart)}</div>
      )}
      {!noDrag && (
        <div className="gantt-bar-handle left" onMouseDown={(e) => handleMouseDown(e, 'resize-left')} />
      )}
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
              // Keep in DOM for measurement; hide when outside label takes over
              visibility: (labelOutside && !labelFits) ? 'hidden' : 'visible',
            }}
            onMouseEnter={!labelOutside ? handleLabelMouseEnter : undefined}
            onMouseLeave={!labelOutside ? handleLabelMouseLeave : undefined}
          >{label} <span className="gantt-bar-duration">({duration}d)</span></span>
        )}
      </div>
      {!noDrag && (
        <div className="gantt-bar-handle right" onMouseDown={(e) => handleMouseDown(e, 'resize-right')} />
      )}
      {showRightDate && (
        <div className="drag-date-label drag-date-right">{formatShortDate(dragState.newEnd)}</div>
      )}
      {labelOutside && label && !labelFits && (
        <div
          className="gantt-bar-outside-label"
          style={{ left: showRightDate ? 'calc(100% + 95px)' : 'calc(100% + 8px)' }}
        >
          {label} <span className="gantt-bar-duration">({liveDuration}d)</span>
        </div>
      )}
      {tooltipVisible && label && !labelOutside && <div className="gantt-bar-tooltip">{label}</div>}
    </div>
  );
}

// ─── Milestone marker ─────────────────────────────────────────────────────────

function MilestoneMarker({ startDate, taskDate, dayWidth, color, isDone, label, diamondPx, onDragUpdate, onClick }) {
  const offset = diffDays(startDate, parseDate(taskDate));
  const left = offset * dayWidth + dayWidth / 2 - diamondPx / 2;

  const labelRef = useRef(null);
  const didDragRef = useRef(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    didDragRef.current = false;
    const startX = e.clientX;
    const origDate = taskDate;

    const onMouseMove = (ev) => {
      const daysDelta = Math.round((ev.clientX - startX) / dayWidth);
      if (daysDelta === 0) return;
      didDragRef.current = true;
      const newDate = formatDate(addDays(parseDate(origDate), daysDelta));
      onDragUpdate(newDate, newDate);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [taskDate, dayWidth, onDragUpdate]);

  return (
    <div
      className={`milestone-marker ${isDone ? 'done' : ''}`}
      style={{ left, cursor: 'grab', zIndex: tooltipVisible ? 1000 : 2 }}
      onMouseDown={handleMouseDown}
      onClick={(e) => { e.stopPropagation(); if (!didDragRef.current && onClick) onClick(); }}
    >
      <div className="milestone-diamond" style={{ backgroundColor: color, width: diamondPx, height: diamondPx }} />
      <span
        ref={labelRef}
        className="milestone-label"
        onMouseEnter={() => {
          if (labelRef.current && labelRef.current.scrollWidth > labelRef.current.clientWidth)
            setTooltipVisible(true);
        }}
        onMouseLeave={() => setTooltipVisible(false)}
      >
        {label}
      </span>
      {tooltipVisible && <div className="gantt-bar-tooltip">{label}</div>}
    </div>
  );
}

// ─── Today line ───────────────────────────────────────────────────────────────

function TodayLine({ startDate, dayWidth, totalDays }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = diffDays(startDate, today);
  if (offset < 0 || offset >= totalDays) return null;
  return <div className="today-line" style={{ left: offset * dayWidth + dayWidth / 2 }} />;
}

// ─── Main GanttView ───────────────────────────────────────────────────────────

export default function GanttView({
  data,
  calendarEvents,
  calendarConnected,
  onCalendarSetup,
  onTaskClick,
  onPhaseClick,
  onAddTask,
  onTaskUpdate,
  onPhaseUpdate,
  onSaveStatus,
  onReorderPhases,
  onReorderTasks,
}) {
  const [zoom, setZoom] = useState('Month');
  const [collapsed, setCollapsed] = useState({});
  const [density, setDensity] = useState('Regular');
  const [dropIndicator, setDropIndicatorState] = useState(null);
  const [draggingItem, setDraggingItem] = useState(null);
  const [activeCalEvents, setActiveCalEvents] = useState(new Set());

  const toggleCalEvent = useCallback((evId) => {
    setActiveCalEvents(prev => {
      const next = new Set(prev);
      if (next.has(evId)) next.delete(evId); else next.add(evId);
      return next;
    });
  }, []);
  const [listWidth, setListWidth] = useState(() =>
    parseInt(localStorage.getItem('gantt-list-width') || '260', 10)
  );

  const timelineRef = useRef(null);
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const dropIndicatorRef = useRef(null);
  const dataRef = useRef(data);

  useEffect(() => { dataRef.current = data; }, [data]);

  const { dayWidth } = ZOOM_LEVELS[zoom];

  const allDates = [
    ...data.phases.flatMap(p => [p.start, p.end, ...p.tasks.flatMap(t => [t.start, t.end])]),
    ...calendarEvents.map(e => e.start),
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

  const toggleCollapse = (phaseId) => {
    setCollapsed(prev => ({ ...prev, [phaseId]: !prev[phaseId] }));
  };

  const handleTaskDrag = useCallback(async (taskId, newStart, newEnd) => {
    onTaskUpdate(taskId, { start: newStart, end: newEnd });
  }, [onTaskUpdate]);

  const handlePhaseDrag = useCallback(async (phaseId, newStart, newEnd) => {
    onPhaseUpdate(phaseId, { start: newStart, end: newEnd });
  }, [onPhaseUpdate]);

  // ─── List resize ──────────────────────────────────────────────────────────

  const startResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = listWidth;

    const onMouseMove = (mv) => {
      const newWidth = Math.max(160, Math.min(520, startWidth + mv.clientX - startX));
      setListWidth(newWidth);
    };

    const onMouseUp = (mv) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      const finalWidth = Math.max(160, Math.min(520, startWidth + mv.clientX - startX));
      localStorage.setItem('gantt-list-width', String(finalWidth));
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

  const startListDrag = useCallback((e, type, id, phaseId) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type, id, phaseId };
    setDraggingItem({ type, id });
    document.body.style.cursor = 'grabbing';

    const onMouseMove = (mv) => {
      const el = document.elementFromPoint(mv.clientX, mv.clientY);
      if (!el) return;
      const rowEl = el.closest('[data-row-type]');
      if (!rowEl) return;

      const rowType = rowEl.dataset.rowType;
      const rowId = rowEl.dataset.rowId;
      const rowPhaseId = rowEl.dataset.phaseId;
      const rect = rowEl.getBoundingClientRect();
      const isTopHalf = mv.clientY < rect.top + rect.height / 2;
      const drag = dragRef.current;
      if (!drag) return;

      let indicator = null;

      if (drag.type === 'phase' && rowType === 'phase') {
        if (isTopHalf) {
          indicator = { type: 'phase', insertBeforePhaseId: rowId };
        } else {
          const d = dataRef.current;
          const idx = d.phases.findIndex(p => p.id === rowId);
          const next = d.phases[idx + 1];
          indicator = { type: 'phase', insertBeforePhaseId: next ? next.id : null };
        }
      } else if (drag.type === 'task') {
        if (rowType === 'task' && rowPhaseId === drag.phaseId) {
          if (isTopHalf) {
            indicator = { type: 'task', phaseId: drag.phaseId, insertBeforeTaskId: rowId };
          } else {
            const d = dataRef.current;
            const phase = d.phases.find(p => p.id === drag.phaseId);
            const idx = phase ? phase.tasks.findIndex(t => t.id === rowId) : -1;
            const next = phase && idx !== -1 ? phase.tasks[idx + 1] : null;
            indicator = { type: 'task', phaseId: drag.phaseId, insertBeforeTaskId: next ? next.id : null };
          }
        } else if (rowType === 'add-task' && rowPhaseId === drag.phaseId) {
          indicator = { type: 'task', phaseId: drag.phaseId, insertBeforeTaskId: null };
        }
      }

      if (indicator) setDropIndicator(indicator);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';

      const drag = dragRef.current;
      const indicator = dropIndicatorRef.current;

      if (drag && indicator) {
        const d = dataRef.current;
        if (drag.type === 'phase' && indicator.type === 'phase') {
          const ids = d.phases.map(p => p.id);
          const fromIdx = ids.indexOf(drag.id);
          if (fromIdx !== -1) {
            ids.splice(fromIdx, 1);
            if (indicator.insertBeforePhaseId === null) {
              ids.push(drag.id);
            } else {
              const toIdx = ids.indexOf(indicator.insertBeforePhaseId);
              ids.splice(toIdx >= 0 ? toIdx : ids.length, 0, drag.id);
            }
            onReorderPhases(ids);
          }
        } else if (drag.type === 'task' && indicator.type === 'task') {
          const phase = d.phases.find(p => p.id === drag.phaseId);
          if (phase) {
            const ids = phase.tasks.map(t => t.id);
            const fromIdx = ids.indexOf(drag.id);
            if (fromIdx !== -1) {
              ids.splice(fromIdx, 1);
              if (indicator.insertBeforeTaskId === null) {
                ids.push(drag.id);
              } else {
                const toIdx = ids.indexOf(indicator.insertBeforeTaskId);
                ids.splice(toIdx >= 0 ? toIdx : ids.length, 0, drag.id);
              }
              onReorderTasks(drag.phaseId, ids);
            }
          }
        }
      }

      dragRef.current = null;
      setDraggingItem(null);
      setDropIndicator(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onReorderPhases, onReorderTasks, setDropIndicator]);

  // Scroll to today on mount
  useEffect(() => {
    if (timelineRef.current) {
      const todayOffset = diffDays(rangeStart, today) * dayWidth;
      const viewWidth = timelineRef.current.clientWidth;
      timelineRef.current.scrollLeft = Math.max(0, todayOffset - viewWidth / 2);
    }
  }, [zoom]);

  // ─── Build rows ───────────────────────────────────────────────────────────

  const rows = [];

  rows.push({ type: 'cal-header' });

  if (calendarConnected) {
    if (calendarEvents.length === 0) {
      rows.push({ type: 'cal-empty' });
    } else {
      const lanes = computeCalendarLanes(calendarEvents);
      lanes.forEach((events, laneIndex) => rows.push({ type: 'cal-lane', events, laneIndex }));
    }
  } else {
    rows.push({ type: 'cal-connect' });
  }

  data.phases.forEach((phase, phaseIndex) => {
    rows.push({ type: 'phase', phase, phaseIndex });
    if (!collapsed[phase.id]) {
      phase.tasks.forEach((task, taskIndex) =>
        rows.push({ type: 'task', task, phase, phaseIndex, taskIndex })
      );
      rows.push({ type: 'add-task', phase, phaseIndex });
    }
  });

  const DENSITY_LEVELS = { Regular: 40, Compact: 28 };
  const ROW_HEIGHT = DENSITY_LEVELS[density];
  const BAR_HEIGHT = density === 'Compact' ? 18 : 24;
  const DIAMOND_PX = density === 'Compact' ? 12 : 16;

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
        <div className="gantt-list" ref={listRef} style={{ width: listWidth, minWidth: listWidth }}>
          <div className="gantt-list-header">Tasks</div>

          {rows.map((row, i) => {
            if (row.type === 'cal-header') {
              return (
                <div key="cal-header" className="gantt-row gantt-section-header" style={{ height: ROW_HEIGHT }}>
                  <span className="section-icon">📅</span>
                  <span>Calendar</span>
                </div>
              );
            }
            if (row.type === 'cal-connect') {
              return (
                <div key="cal-connect" className="gantt-row gantt-cal-connect" style={{ height: ROW_HEIGHT }}>
                  <button className="cal-connect-link" onClick={onCalendarSetup}>Connect Calendar →</button>
                </div>
              );
            }
            if (row.type === 'cal-empty') {
              return (
                <div key="cal-empty" className="gantt-row gantt-cal-empty" style={{ height: ROW_HEIGHT }}>
                  <span className="muted">No events in range</span>
                </div>
              );
            }
            if (row.type === 'cal-lane') {
              return (
                <div key={`cal-lane-${row.laneIndex}`} className="gantt-row gantt-cal-lane-row" style={{ height: ROW_HEIGHT }} />
              );
            }

            if (row.type === 'phase') {
              const isCollapsed = collapsed[row.phase.id];
              const isDragging = draggingItem?.type === 'phase' && draggingItem?.id === row.phase.id;
              const showIndicatorBefore =
                dropIndicator?.type === 'phase' &&
                dropIndicator.insertBeforePhaseId === row.phase.id &&
                draggingItem?.id !== row.phase.id;

              return (
                <React.Fragment key={row.phase.id}>
                  {showIndicatorBefore && <div className="list-drop-indicator" />}
                  <div
                    data-row-type="phase"
                    data-row-id={row.phase.id}
                    className={`gantt-row gantt-phase-row${isDragging ? ' is-dragging' : ''}`}
                    style={{ height: ROW_HEIGHT, borderLeft: `3px solid ${row.phase.color}` }}
                    onClick={() => !draggingItem && onPhaseClick(row.phase.id)}
                  >
                    <div
                      className="drag-handle"
                      onMouseDown={(e) => startListDrag(e, 'phase', row.phase.id, null)}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder"
                    >⠿</div>
                    <button
                      className="collapse-btn"
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(row.phase.id); }}
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isCollapsed ? '▶' : '▼'}
                    </button>
                    <span className="phase-label" title={getPhaseLabel(row.phase, row.phaseIndex)}>
                      <span className="item-number">{(() => { const p = getPhasePrefix(row.phase); return p ? `${p}\u00a0${row.phaseIndex + 1}` : `${row.phaseIndex + 1}`; })()}</span>
                      <span className="item-name">{row.phase.name}</span>
                    </span>
                    <span className="phase-task-count muted">({row.phase.tasks.length})</span>
                  </div>
                </React.Fragment>
              );
            }

            if (row.type === 'task') {
              const isDragging = draggingItem?.type === 'task' && draggingItem?.id === row.task.id;
              const showIndicatorBefore =
                dropIndicator?.type === 'task' &&
                dropIndicator.insertBeforeTaskId === row.task.id &&
                draggingItem?.id !== row.task.id;
              const taskLabel = getTaskLabel(row.task, row.phaseIndex, row.taskIndex);

              return (
                <React.Fragment key={row.task.id}>
                  {showIndicatorBefore && <div className="list-drop-indicator list-drop-indicator--task" />}
                  <div
                    data-row-type="task"
                    data-row-id={row.task.id}
                    data-phase-id={row.phase.id}
                    className={`gantt-row gantt-task-row${row.task.done ? ' done' : ''}${isDragging ? ' is-dragging' : ''}`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => !draggingItem && onTaskClick(row.task.id)}
                  >
                    <span className="task-indent" />
                    <div
                      className="drag-handle"
                      onMouseDown={(e) => startListDrag(e, 'task', row.task.id, row.phase.id)}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder"
                    >⠿</div>
                    {row.task.milestone
                      ? <span className="task-milestone-dot" style={{ color: row.phase.color }}>◆</span>
                      : <span className="task-done-indicator" style={{ backgroundColor: row.phase.color }} />
                    }
                    <span className="task-label" title={taskLabel}>
                      <span className="item-number">{row.phaseIndex + 1}.{row.taskIndex + 1}</span>
                      <span className="item-name">
                        {row.task.done ? <s>{row.task.name}</s> : row.task.name}
                      </span>
                    </span>
                    <span className="task-dates muted">
                      {row.task.milestone ? row.task.start : `${row.task.start} – ${row.task.end}`}
                    </span>
                  </div>
                </React.Fragment>
              );
            }

            if (row.type === 'add-task') {
              const showTaskEndIndicator =
                dropIndicator?.type === 'task' &&
                dropIndicator.phaseId === row.phase.id &&
                dropIndicator.insertBeforeTaskId === null;

              return (
                <React.Fragment key={`add-task-${row.phase.id}`}>
                  {showTaskEndIndicator && <div className="list-drop-indicator list-drop-indicator--task" />}
                  <div
                    data-row-type="add-task"
                    data-phase-id={row.phase.id}
                    className="gantt-row gantt-add-task-row"
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => onAddTask(row.phase.id)}
                  >
                    <span className="task-indent" />
                    <span className="add-task-btn">+ Add task</span>
                  </div>
                </React.Fragment>
              );
            }

            return null;
          })}

          {/* Drop indicator after last phase */}
          {dropIndicator?.type === 'phase' && dropIndicator.insertBeforePhaseId === null && draggingItem && (
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

              {rows.map((row, i) => {
                const rowStyle = { height: ROW_HEIGHT, position: 'relative' };

                if (row.type === 'cal-header' || row.type === 'cal-connect' || row.type === 'cal-empty') {
                  return <div key={i} className="gantt-timeline-row empty-row" style={rowStyle} />;
                }

                if (row.type === 'cal-lane') {
                  return (
                    <div key={`cal-lane-${row.laneIndex}`} className="gantt-timeline-row" style={rowStyle}>
                      {row.events.map(ev => (
                        <GanttBar
                          key={ev.id}
                          startDate={rangeStart}
                          taskStart={ev.start}
                          taskEnd={ev.end || ev.start}
                          dayWidth={dayWidth}
                          color="rgba(100, 160, 220, 0.5)"
                          isReadOnly={true}
                          isDone={false}
                          label={ev.title}
                          barHeight={BAR_HEIGHT}
                          isActive={activeCalEvents.has(ev.id)}
                          onDragUpdate={() => {}}
                          onClick={null}
                          onDoubleClick={() => toggleCalEvent(ev.id)}
                        />
                      ))}
                    </div>
                  );
                }

                if (row.type === 'phase') {
                  const phaseHasTasks = row.phase.tasks && row.phase.tasks.length > 0;
                  return (
                    <div key={row.phase.id} className="gantt-timeline-row" style={rowStyle}>
                      <GanttBar
                        startDate={rangeStart}
                        taskStart={row.phase.start}
                        taskEnd={row.phase.end}
                        dayWidth={dayWidth}
                        color={row.phase.color}
                        isReadOnly={false}
                        isLocked={phaseHasTasks}
                        isDone={false}
                        label={getPhaseLabel(row.phase, row.phaseIndex)}
                        barHeight={BAR_HEIGHT}
                        onDragUpdate={(s, e) => handlePhaseDrag(row.phase.id, s, e)}
                        onClick={() => onPhaseClick(row.phase.id)}
                      />
                    </div>
                  );
                }

                if (row.type === 'task') {
                  const taskColor = row.task.done ? '#555' : row.phase.color;
                  const taskLabel = getTaskLabel(row.task, row.phaseIndex, row.taskIndex);
                  return (
                    <div key={row.task.id} className="gantt-timeline-row" style={rowStyle}>
                      {row.task.milestone
                        ? <MilestoneMarker
                            startDate={rangeStart}
                            taskDate={row.task.start}
                            dayWidth={dayWidth}
                            color={taskColor}
                            isDone={row.task.done}
                            label={taskLabel}
                            diamondPx={DIAMOND_PX}
                            onDragUpdate={(s, e) => handleTaskDrag(row.task.id, s, e)}
                            onClick={() => onTaskClick(row.task.id)}
                          />
                        : <GanttBar
                            startDate={rangeStart}
                            taskStart={row.task.start}
                            taskEnd={row.task.end}
                            dayWidth={dayWidth}
                            color={taskColor}
                            isReadOnly={false}
                            isDone={row.task.done}
                            label={taskLabel}
                            barHeight={BAR_HEIGHT}
                            labelOutside={true}
                            onDragUpdate={(s, e) => handleTaskDrag(row.task.id, s, e)}
                            onClick={() => onTaskClick(row.task.id)}
                          />
                      }
                    </div>
                  );
                }

                if (row.type === 'add-task') {
                  return <div key={`add-task-${row.phase.id}`} className="gantt-timeline-row empty-row" style={rowStyle} />;
                }

                return <div key={i} className="gantt-timeline-row empty-row" style={rowStyle} />;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

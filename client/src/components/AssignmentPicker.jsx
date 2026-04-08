import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildAssignmentOptions, rgbaFromHex } from '../utils/resourcePlanning.js';

function AssignmentOption({ option, isSelected, onSelect }) {
  const percent = Math.round(option.availability.availabilityRatio * 100);
  const blockedLabel = `${option.availability.blockedDays} of ${option.availability.totalDays} days blocked`;

  return (
    <button
      type="button"
      className={`assignment-option${isSelected ? ' selected' : ''}`}
      style={{
        borderLeft: `4px solid ${option.typeColor || '#4A90D9'}`,
        backgroundColor: isSelected ? rgbaFromHex(option.typeColor, 0.14) : undefined,
      }}
      onClick={() => onSelect(option.id)}
    >
      <div className="assignment-option-main">
        <div>
          <div className="assignment-option-name">{option.name}</div>
          <div className="assignment-option-subtitle">{option.subtitle}</div>
        </div>
        <div className="assignment-option-percent">{percent}% free</div>
      </div>
      <div className="assignment-option-footer">
        <div className="assignment-option-meta">{blockedLabel}</div>
        <div className="assignment-option-bar" aria-hidden="true">
          <div className="assignment-option-bar-free" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </button>
  );
}

export default function AssignmentPicker({
  task,
  items,
  personnel,
  value,
  onChange,
  onClose,
  variant = 'inline',
  position = null,
  showClear = true,
  multiple = false,
}) {
  const wrapperRef = useRef(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const normalizedIncomingValue = useMemo(
    () => (multiple ? (Array.isArray(value) ? value : []) : value),
    [multiple, value]
  );
  const incomingValueKey = multiple
    ? JSON.stringify(normalizedIncomingValue)
    : String(normalizedIncomingValue || '');
  const [draftValue, setDraftValue] = useState(() => normalizedIncomingValue);
  useEffect(() => {
    setDraftValue(normalizedIncomingValue);
  }, [incomingValueKey, normalizedIncomingValue]);
  const selectedIds = useMemo(
    () => (multiple ? new Set(Array.isArray(draftValue) ? draftValue : []) : new Set(draftValue ? [draftValue] : [])),
    [draftValue, multiple]
  );
  const options = useMemo(
    () => buildAssignmentOptions(task, items, personnel),
    [task, items, personnel]
  );

  useEffect(() => {
    if (variant !== 'popover') return undefined;

    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        onClose?.();
      }
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
  }, [onClose, variant]);

  useLayoutEffect(() => {
    if (variant !== 'popover' || !position || !wrapperRef.current) {
      setResolvedPosition(position);
      return;
    }

    const margin = 12;
    const rect = wrapperRef.current.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    setResolvedPosition({
      x: Math.min(Math.max(position.x, margin), maxLeft),
      y: Math.min(Math.max(position.y, margin), maxTop),
    });
  }, [position, options.length, showClear, variant, multiple]);

  return (
    <div
      ref={wrapperRef}
      className={`assignment-picker assignment-picker--${variant}`}
      style={variant === 'popover' && resolvedPosition ? { left: resolvedPosition.x, top: resolvedPosition.y } : undefined}
    >
      <div className="assignment-picker-header">
        <span>{multiple ? 'Assign Assets' : 'Assign Asset'}</span>
        {onClose && (
          <button type="button" className="assignment-picker-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {multiple && (
        <div className="assignment-picker-empty assignment-picker-hint">
          Select one or more assets. Blocker overlays can then appear for each assigned asset type.
        </div>
      )}
      {showClear && (
        <button
          type="button"
          className={`assignment-option assignment-option--clear${selectedIds.size === 0 ? ' selected' : ''}`}
          onClick={() => {
            setDraftValue(multiple ? [] : null);
            onChange(multiple ? [] : null);
            onClose?.();
          }}
        >
          Clear assignment
        </button>
      )}
      <div className="assignment-option-list">
        {options.length === 0 ? (
          <div className="assignment-picker-empty">Create an asset first to assign work.</div>
        ) : (
          options.map((option) => (
            <AssignmentOption
              key={option.id}
              option={option}
              isSelected={selectedIds.has(option.id)}
              onSelect={(memberId) => {
                if (multiple) {
                  const next = new Set(selectedIds);
                  if (next.has(memberId)) next.delete(memberId);
                  else next.add(memberId);
                  const nextValue = [...next];
                  setDraftValue(nextValue);
                  onChange(nextValue);
                  return;
                }
                setDraftValue(memberId);
                onChange(memberId);
                onClose?.();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

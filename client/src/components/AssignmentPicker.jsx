import React, { useEffect, useMemo, useRef } from 'react';
import { buildAssignmentOptions } from '../utils/resourcePlanning.js';

function AssignmentOption({ option, isSelected, onSelect }) {
  const percent = Math.round(option.availability.availabilityRatio * 100);
  const subtitle = option.teamNames.length > 0 ? option.teamNames.join(', ') : 'No team';

  return (
    <button
      type="button"
      className={`assignment-option${isSelected ? ' selected' : ''}`}
      onClick={() => onSelect(option.id)}
    >
      <div className="assignment-option-main">
        <div>
          <div className="assignment-option-name">{option.name}</div>
          <div className="assignment-option-subtitle">{subtitle}</div>
        </div>
        <div className="assignment-option-percent">{percent}%</div>
      </div>
      <div className="assignment-option-bar" aria-hidden="true">
        <div className="assignment-option-bar-free" style={{ width: `${percent}%` }} />
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
}) {
  const wrapperRef = useRef(null);
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

  return (
    <div
      ref={wrapperRef}
      className={`assignment-picker assignment-picker--${variant}`}
      style={variant === 'popover' && position ? { left: position.x, top: position.y } : undefined}
    >
      <div className="assignment-picker-header">
        <span>Assign to</span>
        {onClose && (
          <button type="button" className="assignment-picker-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {showClear && (
        <button
          type="button"
          className={`assignment-option assignment-option--clear${!value ? ' selected' : ''}`}
          onClick={() => {
            onChange(null);
            onClose?.();
          }}
        >
          Unassigned
        </button>
      )}
      <div className="assignment-option-list">
        {options.length === 0 ? (
          <div className="assignment-picker-empty">Create a team member first to assign work.</div>
        ) : (
          options.map((option) => (
            <AssignmentOption
              key={option.id}
              option={option}
              isSelected={value === option.id}
              onSelect={(memberId) => {
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

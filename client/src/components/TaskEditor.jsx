import React, { useState, useEffect, useRef } from 'react';

const PHASE_COLORS = [
  '#4A90D9', '#E67E22', '#27AE60', '#8E44AD',
  '#E74C3C', '#16A085', '#F39C12', '#2C3E50',
];

export default function TaskEditor({ item, type, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    setForm({ ...item });
    setConfirmDelete(false);
  }, [item]);

  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!item || !form) return null;

  const groupDatesLocked = type === 'group' && item.children && item.children.length > 0;

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const isMilestone = type === 'task' && !!form.milestone;
    onSave(type === 'task'
      ? { name: form.name, start: form.start, end: isMilestone ? form.start : form.end, done: form.done, notes: form.notes, milestone: isMilestone }
      : { name: form.name, start: form.start, end: form.end, color: form.color, prefix: form.prefix ?? 'WP' }
    );
    // type === 'group' uses same fields as old 'phase'
    onClose();
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">
            {type === 'group' ? 'Edit Group' : 'Edit Task'}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {/* Name */}
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              type="text"
              value={form.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              autoFocus
            />
          </div>

          {/* Milestone toggle — tasks only */}
          {type === 'task' && (
            <div className="form-group form-group-inline">
              <input
                id="task-milestone"
                type="checkbox"
                className="form-checkbox"
                checked={!!form.milestone}
                onChange={(e) => {
                  handleChange('milestone', e.target.checked);
                  if (e.target.checked) handleChange('end', form.start);
                }}
              />
              <label htmlFor="task-milestone" className="form-label-inline">Milestone</label>
            </div>
          )}

          {/* Dates */}
          {type === 'task' && !!form.milestone ? (
            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                className="form-input form-input-date"
                type="date"
                value={form.start || ''}
                onChange={(e) => { handleChange('start', e.target.value); handleChange('end', e.target.value); }}
              />
            </div>
          ) : (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">
                  Start date
                  {groupDatesLocked && <span className="form-label-note"> — set by tasks</span>}
                </label>
                <input
                  className="form-input form-input-date"
                  type="date"
                  value={form.start || ''}
                  disabled={groupDatesLocked}
                  onChange={(e) => handleChange('start', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  End date
                  {groupDatesLocked && <span className="form-label-note"> — set by tasks</span>}
                </label>
                <input
                  className="form-input form-input-date"
                  type="date"
                  value={form.end || ''}
                  min={form.start || ''}
                  disabled={groupDatesLocked}
                  onChange={(e) => handleChange('end', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Phase prefix */}
          {type === 'group' && (
            <div className="form-group">
              <label className="form-label">Prefix</label>
              <div className="prefix-picker">
                {['WP', 'Phase', ''].map((p) => (
                  <button
                    key={p === '' ? 'none' : p}
                    className={`btn btn-zoom ${form.prefix === p || (p === 'WP' && form.prefix === undefined) ? 'active' : ''}`}
                    onClick={() => handleChange('prefix', p)}
                    type="button"
                  >
                    {p === '' ? 'None' : p}
                  </button>
                ))}
                <input
                  className="form-input prefix-custom-input"
                  type="text"
                  placeholder="Custom…"
                  value={['WP', 'Phase', ''].includes(form.prefix ?? 'WP') ? '' : (form.prefix || '')}
                  onChange={(e) => handleChange('prefix', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Phase color picker */}
          {type === 'group' && (
            <div className="form-group">
              <label className="form-label">Color</label>
              <div className="color-picker">
                {PHASE_COLORS.map(color => (
                  <button
                    key={color}
                    className={`color-swatch ${form.color === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => handleChange('color', color)}
                    title={color}
                  />
                ))}
                <input
                  type="color"
                  className="color-custom"
                  value={form.color || '#4A90D9'}
                  onChange={(e) => handleChange('color', e.target.value)}
                  title="Custom color"
                />
              </div>
            </div>
          )}

          {/* Done checkbox — tasks only */}
          {type === 'task' && (
            <div className="form-group form-group-inline">
              <input
                id="task-done"
                type="checkbox"
                className="form-checkbox"
                checked={!!form.done}
                onChange={(e) => handleChange('done', e.target.checked)}
              />
              <label htmlFor="task-done" className="form-label-inline">Mark as done</label>
            </div>
          )}

          {/* Notes — tasks only */}
          {type === 'task' && (
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input form-textarea"
                value={form.notes || ''}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={4}
                placeholder="Add notes here..."
              />
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className={`btn btn-danger ${confirmDelete ? 'btn-danger-confirm' : ''}`}
            onClick={handleDelete}
          >
            {confirmDelete ? 'Click again to confirm delete' : 'Delete'}
          </button>
          <div className="modal-footer-right">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

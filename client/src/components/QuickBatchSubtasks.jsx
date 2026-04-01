import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const QUICK_BATCH_EXAMPLE = ['- Design tokens', '- Hook up persistence', '- Polish interactions'].join('\n');

export default function QuickBatchSubtasks({ x, y, onCreate, onClose }) {
  const [draft, setDraft] = useState('- ');
  const [isCreating, setIsCreating] = useState(false);
  const panelRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.focus();
    const initialCaret = draft.length;
    textareaRef.current.setSelectionRange(initialCaret, initialCaret);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    const handlePointerDown = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    const panel = panelRef.current;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;

    const rect = panel.getBoundingClientRect();
    const nextLeft = Math.min(Math.max(12, x), window.innerWidth - rect.width - 12);
    const nextTop = Math.min(Math.max(12, y), window.innerHeight - rect.height - 12);
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  }, [x, y]);

  const batchLines = draft
    .split(/\r?\n/)
    .map(line => line.trim())
    .map((line) => {
      const match = line.match(/^[-*+](?:\s+(.*))?$/);
      return match ? (match[1] || '').trim() : '';
    })
    .filter((name) => name && !/^[-*+\s]+$/.test(name));

  const submit = async () => {
    if (isCreating || batchLines.length === 0) return;
    setIsCreating(true);
    const ok = await onCreate(draft);
    setIsCreating(false);
    if (ok) onClose();
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key !== 'Enter') return;

    event.preventDefault();
    const { selectionStart, selectionEnd, value } = event.currentTarget;
    const insertion = '\n- ';
    const nextValue = `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`;
    setDraft(nextValue);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.selectionStart = selectionStart + insertion.length;
      textareaRef.current.selectionEnd = selectionStart + insertion.length;
    });
  };

  return (
    <div ref={panelRef} className="quick-batch-panel" role="dialog" aria-label="Batch create subtasks">
      <div className={`quick-batch-editor${draft.trim() === '-' ? ' is-empty' : ''}`}>
        {draft.trim() === '-' && (
          <pre className="quick-batch-placeholder" aria-hidden="true">{QUICK_BATCH_EXAMPLE}</pre>
        )}
        <textarea
          ref={textareaRef}
          className="quick-batch-textarea"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={5}
          spellCheck={false}
        />
      </div>
      <div className="quick-batch-actions">
        <button
          className="btn btn-secondary btn-small"
          type="button"
          title="Create subtasks (Shift + Enter)"
          disabled={batchLines.length === 0 || isCreating}
          onClick={submit}
        >
          {isCreating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

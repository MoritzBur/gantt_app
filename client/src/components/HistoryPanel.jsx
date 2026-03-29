import React, { useState, useEffect, useRef } from 'react';

export default function HistoryPanel({ onClose, onViewSnapshot, gitDirty, onCommitted }) {
  const [commits, setCommits] = useState(null);
  const [loadingCommits, setLoadingCommits] = useState(true);
  const [loadingHash, setLoadingHash] = useState(null);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState(null); // { ok, text } | null
  const msgRef = useRef(null);

  const loadCommits = () => {
    setLoadingCommits(true);
    fetch('/api/git/log')
      .then(r => r.json())
      .then(data => {
        setCommits(Array.isArray(data) ? data : []);
        setLoadingCommits(false);
      })
      .catch(() => {
        setCommits([]);
        setLoadingCommits(false);
      });
  };

  useEffect(() => {
    loadCommits();
    msgRef.current?.focus();
  }, []);

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    setCommitResult(null);
    try {
      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCommitResult({ ok: false, text: data.error || 'Commit failed' });
      } else {
        setCommitResult({ ok: true, text: data.output || 'Committed.' });
        setCommitMsg('');
        loadCommits();
        onCommitted?.();
      }
    } catch (err) {
      setCommitResult({ ok: false, text: 'Commit failed: ' + err.message });
    } finally {
      setCommitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit();
  };

  const handleView = async (commit) => {
    setLoadingHash(commit.hash);
    try {
      const res = await fetch(`/api/git/show/${commit.hash}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      onViewSnapshot({ ...data, hash: commit.hash, date: commit.date, message: commit.message });
      onClose();
    } catch {
      alert('Failed to load snapshot');
    } finally {
      setLoadingHash(null);
    }
  };

  return (
    <div className="history-panel-backdrop" onClick={onClose}>
      <div className="history-panel" onClick={e => e.stopPropagation()}>
        <div className="history-panel-header">
          <span className="history-panel-title">Snapshots</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Commit form */}
        <div className="history-commit-form">
          <div className="history-commit-form-label">
            <span>Create snapshot</span>
            {gitDirty
              ? <span className="history-dirty-badge">● unsaved changes</span>
              : <span className="history-clean-badge">✓ up to date</span>
            }
          </div>
          <textarea
            ref={msgRef}
            className="history-commit-input"
            placeholder="Describe what changed…"
            value={commitMsg}
            onChange={e => { setCommitMsg(e.target.value); setCommitResult(null); }}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={committing}
          />
          <div className="history-commit-form-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={handleCommit}
              disabled={committing || !commitMsg.trim()}
            >
              {committing ? 'Committing…' : 'Commit snapshot'}
            </button>
            <span className="history-commit-hint">⌘↵</span>
            {commitResult && (
              <span className={commitResult.ok ? 'history-commit-ok' : 'history-commit-err'}>
                {commitResult.text}
              </span>
            )}
          </div>
        </div>

        {/* Commit list */}
        <div className="history-panel-body">
          {loadingCommits && <p className="history-state-msg">Loading…</p>}
          {!loadingCommits && commits && commits.length === 0 && (
            <div className="history-empty-state">
              <p>No snapshots yet.</p>
              <p className="history-hint">
                Use the form above to save your first snapshot.
              </p>
            </div>
          )}
          {!loadingCommits && commits && commits.map(commit => (
            <div key={commit.hash} className="history-commit-row">
              <div className="history-commit-info">
                <span className="history-commit-hash">{commit.hash}</span>
                <span className="history-commit-message">{commit.message}</span>
                <span className="history-commit-date">
                  {new Date(commit.date).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => handleView(commit)}
                disabled={loadingHash === commit.hash}
              >
                {loadingHash === commit.hash ? '…' : 'View'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

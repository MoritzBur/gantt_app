import React, { useMemo, useRef } from 'react';
import MarkdownEditor from './MarkdownEditor.jsx';

function getTabTitle(tab, content) {
  const firstHeading = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#\s+/.test(line));

  if (firstHeading) return firstHeading.replace(/^#\s+/, '').trim();
  return (tab.filename || 'Untitled').replace(/\.md$/i, '');
}

export function getTabKey(tab) {
  return `${tab.type}:${tab.itemId}:${tab.filename}`;
}

export default function NotePanelTab({
  tab,
  cacheEntry,
  itemMeta,
  allNotes,
  theme,
  onContentChange,
  onNavigateLink,
}) {
  const editorRef = useRef(null);

  const toolbarButtons = useMemo(() => ([
    {
      key: 'checkbox',
      label: 'Checkbox',
      shortcut: 'Alt+1',
      action: () => editorRef.current?.insertLinePrefix('- [ ] ', 'Todo'),
    },
    {
      key: 'bullet',
      label: 'Bullet',
      shortcut: 'Alt+2',
      action: () => editorRef.current?.insertLinePrefix('- ', 'List item'),
    },
    {
      key: 'heading',
      label: 'Heading',
      shortcut: 'Alt+3',
      action: () => editorRef.current?.insertLinePrefix('# ', 'Heading'),
    },
    {
      key: 'bold',
      label: 'Bold',
      shortcut: 'Alt+4',
      action: () => editorRef.current?.insertAroundSelection('**', '**', 'bold'),
    },
    {
      key: 'Link',
      label: 'Wiki Link',
      shortcut: 'Alt+5',
      action: () => editorRef.current?.insertWikiLink(),
    },
    {
      key: 'tag',
      label: 'Tag',
      shortcut: 'Alt+6',
      action: () => editorRef.current?.insertTemplate('#tag', 4),
    },
  ]), []);

  if (!tab) return null;

  if (cacheEntry?.status === 'loading') {
    return <div className="note-panel-status">Loading note…</div>;
  }

  if (cacheEntry?.status === 'error') {
    return (
      <div className="note-panel-status error">
        {cacheEntry.message || 'This note could not be loaded.'}
      </div>
    );
  }

  return (
    <div className="note-panel-tab">
      <div
        className="note-panel-tab-meta"
        style={{ '--note-accent': itemMeta?.color || 'var(--accent)' }}
      >
        <span className="note-panel-tab-title">
          {itemMeta?.label || getTabTitle(tab, cacheEntry?.content)}
        </span>
        <span className="note-panel-tab-path">
          {tab.type === 'related' ? 'Related note' : 'Main note'} · {cacheEntry?.workspacePath || tab.filename}
        </span>
      </div>
      <div className="note-panel-editor-wrap">
        <MarkdownEditor
          ref={editorRef}
          value={cacheEntry?.content || ''}
          onChange={onContentChange}
          onNavigateLink={onNavigateLink}
          allNotes={allNotes}
          noteWorkspacePath={cacheEntry?.workspacePath || ''}
          theme={theme}
        />
      </div>
      <div className="note-toolbar">
        {toolbarButtons.map((button) => (
          <button
            key={button.key}
            className="note-toolbar-button"
            type="button"
            onClick={button.action}
            data-tooltip={`${button.label} · ${button.shortcut}`}
            title={`${button.label} (${button.shortcut})`}
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

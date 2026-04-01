import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { acceptCompletion, autocompletion, startCompletion } from '@codemirror/autocomplete';
import { keymap, Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkup } from '@codemirror/lang-markdown';

const wikiLinkPattern = /\[\[([^[\]]+)\]\]/g;
const headingPattern = /^(#{1,3})(\s+)/;
const checkboxPattern = /^(\s*[-*]\s)\[( |x)\](\s+)/i;
const tagPattern = /(^|\s)(#[A-Za-z0-9/_-]+)/g;

class CheckboxWidget extends WidgetType {
  constructor(checked, onToggle) {
    super();
    this.checked = checked;
    this.onToggle = onToggle;
  }

  eq(other) {
    return other.checked === this.checked;
  }

  toDOM() {
    const wrapper = document.createElement('span');
    wrapper.className = 'cm-checkbox-widget-wrap';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.checked;
    checkbox.className = 'cm-checkbox-widget';
    checkbox.setAttribute('aria-label', this.checked ? 'Mark unchecked' : 'Mark checked');
    checkbox.addEventListener('mousedown', (event) => event.preventDefault());
    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onToggle();
    });

    wrapper.appendChild(checkbox);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

class HiddenPrefixWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-hidden-prefix';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
}

function createThemeExtension(theme) {
  const isLight = theme === 'light';

  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--text)',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
    },
    '.cm-scroller': {
      overflow: 'auto',
      padding: '18px 20px 28px',
      fontFamily: 'inherit',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      minHeight: '100%',
      whiteSpace: 'pre-wrap',
    },
    '.cm-line': {
      padding: '0 0 0 2px',
    },
    '.cm-gutters': {
      display: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: isLight ? 'rgba(53, 120, 200, 0.08)' : 'rgba(74, 144, 217, 0.1)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: isLight ? 'rgba(53, 120, 200, 0.24)' : 'rgba(74, 144, 217, 0.28)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--accent)',
    },
    '.cm-placeholder': {
      color: 'var(--text-dim)',
    },
    '.cm-tooltip': {
      border: '1px solid var(--border)',
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text)',
    },
    '.cm-completionIcon': {
      display: 'none',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: isLight ? 'rgba(53, 120, 200, 0.12)' : 'rgba(74, 144, 217, 0.16)',
      color: 'var(--text)',
    },
    '.cm-wiki-link': {
      color: 'var(--accent)',
      textDecoration: 'underline',
      textDecorationThickness: '1px',
      cursor: 'pointer',
    },
    '.cm-tag': {
      color: 'var(--success)',
      backgroundColor: isLight ? 'rgba(31, 143, 87, 0.1)' : 'rgba(39, 174, 96, 0.14)',
      borderRadius: '999px',
      padding: '0 0.18rem',
    },
    '.cm-header.cm-header-1': {
      fontSize: '1.55em',
      fontWeight: '700',
      color: 'var(--text)',
    },
    '.cm-header.cm-header-2': {
      fontSize: '1.28em',
      fontWeight: '650',
      color: 'var(--text)',
    },
    '.cm-header.cm-header-3': {
      fontSize: '1.15em',
      fontWeight: '650',
      color: 'var(--text)',
    },
    '.cm-heading-line': {
      fontFamily: 'var(--font-sans)',
      color: 'var(--text)',
    },
    '.cm-heading-line-1': {
      fontSize: '1.65em',
      fontWeight: '700',
      lineHeight: '1.35',
      paddingTop: '0.35em',
    },
    '.cm-heading-line-2': {
      fontSize: '1.35em',
      fontWeight: '680',
      lineHeight: '1.4',
      paddingTop: '0.28em',
    },
    '.cm-heading-line-3': {
      fontSize: '1.15em',
      fontWeight: '650',
      lineHeight: '1.45',
      paddingTop: '0.2em',
    },
    '.cm-formatting-hidden': {
      color: 'transparent',
    },
    '.cm-checkbox-line': {
      paddingLeft: '2px',
    },
    '.cm-checkbox-widget-wrap': {
      display: 'inline-flex',
      alignItems: 'center',
      marginRight: '0.2rem',
      verticalAlign: 'middle',
    },
    '.cm-checkbox-widget': {
      width: '14px',
      height: '14px',
      accentColor: 'var(--accent)',
      cursor: 'pointer',
    },
  });
}

function wikiLinkDecorations(view) {
  const builder = new RangeSetBuilder();
  const selectionHead = view.state.selection.main.head;

  for (const { from, to } of view.visibleRanges) {
    let lineStart = view.state.doc.lineAt(from).number;
    const lineEnd = view.state.doc.lineAt(to).number;

    while (lineStart <= lineEnd) {
      const lineNumber = lineStart;
      const line = view.state.doc.line(lineStart);
      const isActiveLine = view.hasFocus && selectionHead >= line.from && selectionHead <= line.to;
      const text = line.text;

      const headingMatch = text.match(headingPattern);
      if (headingMatch) {
        const level = headingMatch[1].length;
        builder.add(line.from, line.from, Decoration.line({ attributes: { class: `cm-heading-line cm-heading-line-${level}` } }));
        if (!isActiveLine) {
          builder.add(
            line.from,
            line.from + headingMatch[0].length,
            Decoration.replace({ widget: new HiddenPrefixWidget(), inclusive: false }),
          );
        }
      }

      const checkboxMatch = text.match(checkboxPattern);
      if (checkboxMatch) {
        const markerStart = line.from + checkboxMatch[1].length;
        const markerEnd = markerStart + 3;
        builder.add(line.from, line.from, Decoration.line({ attributes: { class: 'cm-checkbox-line' } }));
        if (!isActiveLine) {
          const checked = checkboxMatch[2].toLowerCase() === 'x';
          builder.add(
            markerStart,
            markerEnd,
            Decoration.replace({
              widget: new CheckboxWidget(checked, () => {
                const currentLine = view.state.doc.line(lineNumber);
                const currentMatch = currentLine.text.match(checkboxPattern);
                if (!currentMatch) return;
                const currentMarkerStart = currentLine.from + currentMatch[1].length;
                const nextValue = currentMatch[2].toLowerCase() === 'x' ? ' ' : 'x';
                view.dispatch({
                  changes: { from: currentMarkerStart + 1, to: currentMarkerStart + 2, insert: nextValue },
                });
              }),
              inclusive: false,
            }),
          );
        }
      }

      let match;
      while ((match = wikiLinkPattern.exec(text))) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        builder.add(start, end, Decoration.mark({ class: 'cm-wiki-link' }));
      }

      wikiLinkPattern.lastIndex = 0;

      while ((match = tagPattern.exec(text))) {
        const prefixLength = match[1] ? match[1].length : 0;
        const start = line.from + match.index + prefixLength;
        const end = start + match[2].length;
        builder.add(start, end, Decoration.mark({ class: 'cm-tag' }));
      }

      tagPattern.lastIndex = 0;
      lineStart += 1;
    }
  }

  return builder.finish();
}

function findWikiLinkAtPosition(state, position) {
  const line = state.doc.lineAt(position);
  let match;

  while ((match = wikiLinkPattern.exec(line.text))) {
    const start = line.from + match.index;
    const end = start + match[0].length;
    if (position >= start && position <= end) {
      return {
        text: match[1].trim(),
        from: start,
        to: end,
      };
    }
  }

  return null;
}

function createWikiLinkPlugin(onNavigateLinkRef) {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = wikiLinkDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = wikiLinkDecorations(update.view);
      }
    }
  }, {
    decorations: (instance) => instance.decorations,
    eventHandlers: {
      click(event, view) {
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position == null) return false;

        const link = findWikiLinkAtPosition(view.state, position);
        if (!link) return false;

        event.preventDefault();
        onNavigateLinkRef.current?.(link.text, { newTab: !!event.shiftKey });
        return true;
      },
    },
  });
}

function createWikiLinkCompletions(allNotesRef) {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = before.match(/\[\[([^[\]]*)$/);
    if (!match) return null;

    const query = match[1].toLowerCase();
    const seen = new Set();
    const options = [];

    for (const note of allNotesRef.current || []) {
      const basename = note.basename || note.filename?.replace(/\.md$/i, '') || '';
      const aliases = Array.isArray(note.aliases) ? note.aliases.filter(Boolean) : [];
      const searchTerms = Array.from(new Set([
        basename,
        note.itemName,
        note.label,
        ...aliases,
      ].filter(Boolean)));

      if (searchTerms.length === 0) continue;
      const key = basename.toLowerCase();
      if (seen.has(key)) continue;
      const normalizedTerms = searchTerms.map((term) => String(term).toLowerCase());
      const matches = !query || normalizedTerms.some((term) => term.includes(query));
      if (!matches) continue;
      const startsWith = query && normalizedTerms.some((term) => term.startsWith(query));
      seen.add(key);
      options.push({
        label: note.type === 'main' ? (note.label || note.itemName || basename) : basename,
        detail: note.workspacePath || note.filename || '',
        boost: startsWith ? 2 : 1,
        apply(view, completion, from, to) {
          view.dispatch({
            changes: { from, to, insert: `[[${basename}]]` },
            selection: { anchor: from + basename.length + 4 },
          });
        },
      });
    }

    options.sort((a, b) => (
      (b.boost || 0) - (a.boost || 0) ||
      a.label.localeCompare(b.label)
    ));

    return {
      from: context.pos - match[0].length,
      options: options.slice(0, 20),
      filter: false,
      validFor: /^[^[\]]*$/,
    };
  };
}

const MarkdownEditor = forwardRef(function MarkdownEditor({
  value,
  onChange,
  onNavigateLink,
  allNotes,
  theme = 'dark',
  readOnly = false,
  placeholder = 'Write your note here…',
}, ref) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onNavigateLinkRef = useRef(onNavigateLink);
  const allNotesRef = useRef(allNotes);

  onChangeRef.current = onChange;
  onNavigateLinkRef.current = onNavigateLink;
  allNotesRef.current = allNotes;

  const applyInsertAroundSelection = (view, prefix, suffix = '', placeholderText = '') => {
    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    const content = selectedText || placeholderText;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: `${prefix}${content}${suffix}` },
      selection: {
        anchor: selection.from + prefix.length,
        head: selection.from + prefix.length + content.length,
      },
    });
    view.focus();
    return true;
  };

  const applyInsertLinePrefix = (view, prefix, placeholderText = '') => {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.from);
    const hasSelection = selection.from !== selection.to;
    const existing = view.state.sliceDoc(selection.from, selection.to);
    const insert = hasSelection ? `${prefix}${existing}` : `${prefix}${placeholderText}`;
    const from = hasSelection ? selection.from : line.from;
    const to = hasSelection ? selection.to : line.from;
    view.dispatch({
      changes: { from, to, insert },
      selection: {
        anchor: hasSelection ? from : from + prefix.length,
        head: hasSelection ? from + insert.length : from + prefix.length + placeholderText.length,
      },
    });
    view.focus();
    return true;
  };

  const applyInsertTemplate = (view, template, cursorOffset = template.length) => {
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: template },
      selection: { anchor: selection.from + cursorOffset },
    });
    view.focus();
    return true;
  };

  const applyInsertWikiLink = (view) => {
    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to).trim();
    const linkText = selectedText || '';
    const insert = `[[${linkText}]]`;
    const from = selection.from;
    const to = selection.to;
    const anchor = from + 2;
    const head = anchor + linkText.length;

    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor, head },
    });
    view.focus();
    startCompletion(view);
    return true;
  };

  const extensions = useMemo(() => ([
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
      { key: 'Enter', run: insertNewlineContinueMarkup },
      { key: 'Tab', run: acceptCompletion },
      { key: 'Alt-1', run: (view) => applyInsertLinePrefix(view, '- [ ] ', 'Todo') },
      { key: 'Alt-2', run: (view) => applyInsertLinePrefix(view, '- ', 'List item') },
      { key: 'Alt-3', run: (view) => applyInsertLinePrefix(view, '# ', 'Heading') },
      { key: 'Alt-4', run: (view) => applyInsertAroundSelection(view, '**', '**', 'bold') },
      { key: 'Alt-5', run: (view) => applyInsertWikiLink(view) },
      { key: 'Alt-6', run: (view) => applyInsertTemplate(view, '#tag', 4) },
    ]),
    markdown(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    }),
    autocompletion({ override: [createWikiLinkCompletions(allNotesRef)] }),
    createWikiLinkPlugin(onNavigateLinkRef),
    createThemeExtension(theme),
  ]), [readOnly, theme]);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const state = EditorState.create({
      doc: value || '',
      extensions,
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });

    view.contentDOM.setAttribute('aria-label', placeholder);
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions, placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue === (value || '')) return;

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value || '' },
    });
  }, [value]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    insertAroundSelection(prefix, suffix = '', placeholderText = '') {
      const view = viewRef.current;
      if (!view) return;
      applyInsertAroundSelection(view, prefix, suffix, placeholderText);
    },
    insertLinePrefix(prefix, placeholderText = '') {
      const view = viewRef.current;
      if (!view) return;
      applyInsertLinePrefix(view, prefix, placeholderText);
    },
    insertTemplate(template, cursorOffset = template.length) {
      const view = viewRef.current;
      if (!view) return;
      applyInsertTemplate(view, template, cursorOffset);
    },
    insertWikiLink() {
      const view = viewRef.current;
      if (!view) return;
      applyInsertWikiLink(view);
    },
  }), []);

  return <div className="markdown-editor" ref={hostRef} />;
});

export default MarkdownEditor;

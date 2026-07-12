import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actions,
  openDialog,
  setPaletteOpen,
  toggleRedactMode,
  useAppState,
} from '../state/store';
import { openViaDialog, saveActiveDoc } from '../lib/files';
import { exportImagesFlow, exportTextFlow } from '../lib/convert';

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  enabled: boolean;
  run: () => void;
}

/**
 * Ctrl+K command palette (build guide Phase 9). Lists every app action with its
 * shortcut so nothing has to be memorized, filters as you type, and runs the
 * top match on Enter. Shortcuts here mirror the audited bindings in App.tsx.
 */
export function CommandPalette() {
  const state = useAppState();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasDoc = state.activeId !== null;
  const hasSel = state.selection.length > 0;
  const multiDoc = state.docs.length >= 2;
  const doc = state.docs.find((d) => d.id === state.activeId) ?? null;

  const commands = useMemo<Command[]>(() => {
    const close = () => setPaletteOpen(false);
    const withClose = (fn: () => void) => () => {
      close();
      fn();
    };
    return [
      { id: 'open', label: 'Open PDF…', shortcut: 'Ctrl+O', enabled: true, run: withClose(() => void openViaDialog()) },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S', enabled: hasDoc, run: withClose(() => void saveActiveDoc()) },
      { id: 'merge', label: 'Merge open documents…', shortcut: 'Ctrl+M', enabled: multiDoc, run: () => openDialog('merge') },
      { id: 'split', label: 'Split…', shortcut: 'Ctrl+Shift+S', enabled: hasDoc, run: () => openDialog('split') },
      { id: 'rotate', label: 'Rotate selected 90°', shortcut: 'Ctrl+R', enabled: hasDoc, run: withClose(() => void actions.rotateSelection(90)) },
      { id: 'delete', label: 'Delete selected page(s)', shortcut: 'Ctrl+D', enabled: hasSel, run: withClose(() => void actions.deleteSelection()) },
      { id: 'extract', label: 'Extract selected to new document', shortcut: 'Ctrl+E', enabled: hasSel, run: withClose(() => void actions.extractSelection()) },
      { id: 'compress', label: 'Compress (preset or target size)…', shortcut: 'Ctrl+Shift+C', enabled: hasDoc, run: () => openDialog('compress') },
      { id: 'watermark', label: 'Add watermark…', shortcut: 'Ctrl+Shift+W', enabled: hasDoc, run: () => openDialog('watermark') },
      { id: 'pagenumbers', label: 'Add page numbers…', enabled: hasDoc, run: () => openDialog('pagenumbers') },
      { id: 'normalize', label: 'Normalize page size…', enabled: hasDoc, run: () => openDialog('normalize') },
      { id: 'metadata', label: 'Document properties (title)…', enabled: hasDoc, run: () => openDialog('metadata') },
      { id: 'redact', label: `Redaction mode: ${state.redactMode ? 'on' : 'off'}`, shortcut: 'Ctrl+Shift+R', enabled: hasDoc, run: () => toggleRedactMode() },
      { id: 'batch', label: 'Batch process multiple files…', enabled: true, run: () => openDialog('batch') },
      { id: 'ocr', label: 'OCR scanned pages…', enabled: hasDoc, run: () => openDialog('ocr') },
      { id: 'export-text', label: 'Export text → .txt', enabled: hasDoc, run: withClose(() => void exportTextFlow()) },
      { id: 'export-images', label: 'Export pages → PNG', enabled: hasDoc, run: withClose(() => void exportImagesFlow()) },
      { id: 'undo', label: doc?.history.length ? `Undo ${doc.history[doc.history.length - 1]!.label}` : 'Undo', shortcut: 'Ctrl+Z', enabled: !!doc?.history.length, run: withClose(() => actions.undo()) },
      { id: 'redo', label: doc?.future.length ? `Redo ${doc.future[doc.future.length - 1]!.label}` : 'Redo', shortcut: 'Ctrl+Shift+Z', enabled: !!doc?.future.length, run: withClose(() => actions.redo()) },
    ];
  }, [hasDoc, hasSel, multiDoc, state.redactMode, doc]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
    return list;
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setCursor(0);
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setPaletteOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd && cmd.enabled) cmd.run();
    }
  };

  return (
    <div className="dialog-backdrop" onClick={() => setPaletteOpen(false)}>
      <div
        className="dialog cropmarks palette"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)', alignSelf: 'flex-start', marginTop: '12vh' }}
      >
        <input
          ref={inputRef}
          className="input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <ul className="palette-list" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, maxHeight: '46vh', overflowY: 'auto' }}>
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                className={`palette-item${i === cursor ? ' active' : ''}`}
                disabled={!c.enabled}
                onMouseEnter={() => setCursor(i)}
                onClick={() => c.enabled && c.run()}
                style={{
                  display: 'flex',
                  width: '100%',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 10px',
                  border: 'none',
                  borderRadius: 4,
                  background: i === cursor ? 'var(--panel-2)' : 'transparent',
                  color: c.enabled ? 'var(--ink)' : 'var(--ink-dim)',
                  cursor: c.enabled ? 'pointer' : 'default',
                  textAlign: 'left',
                }}
              >
                <span>{c.label}</span>
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {!filtered.length && <li className="hint" style={{ padding: '8px 10px' }}>No matching command.</li>}
        </ul>
      </div>
    </div>
  );
}

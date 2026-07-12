import { useEffect } from 'react';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './theme.css';
import './app.css';
import {
  actions,
  clearError,
  closeDialog,
  openDialog,
  setPaletteOpen,
  toggleRedactMode,
  useAppState,
} from './state/store';
import { openDroppedFiles, openViaDialog, saveActiveDoc } from './lib/files';
import { Home } from './components/Home';
import { Workspace } from './components/Workspace';
import { CommandPalette } from './components/CommandPalette';

export function App() {
  const state = useAppState();
  const doc = state.docs.find((d) => d.id === state.activeId) ?? null;

  // Keyboard shortcuts (collision-audited table in the build guide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        // Close palette first, then any open dialog / redaction mode.
        setPaletteOpen(false);
        closeDialog();
        return;
      }
      if (mod && k === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && k === 'o') {
        e.preventDefault();
        void openViaDialog();
      } else if (mod && k === 's' && e.shiftKey) {
        e.preventDefault();
        openDialog('split');
      } else if (mod && k === 's') {
        e.preventDefault();
        void saveActiveDoc();
      } else if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        actions.redo();
      } else if (mod && k === 'm') {
        e.preventDefault();
        if (state.docs.length >= 2) openDialog('merge');
      } else if (mod && k === 'r' && e.shiftKey) {
        e.preventDefault();
        toggleRedactMode();
      } else if (mod && k === 'r') {
        e.preventDefault();
        void actions.rotateSelection(90);
      } else if (mod && k === 'w' && e.shiftKey) {
        e.preventDefault();
        openDialog('watermark');
      } else if (mod && k === 'c' && e.shiftKey) {
        e.preventDefault();
        openDialog('compress');
      } else if (mod && k === 'e') {
        e.preventDefault();
        void actions.extractSelection();
      } else if ((mod && k === 'd') || e.key === 'Delete') {
        if (e.key === 'Delete' && isEditable(e.target)) return;
        e.preventDefault();
        void actions.deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.docs.length]);

  return (
    <div
      className="shell"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void openDroppedFiles(e.dataTransfer.files);
      }}
    >
      {doc ? <Workspace doc={doc} /> : <Home />}

      {state.paletteOpen && <CommandPalette />}

      {state.busy && (
        <div className="busy-overlay">
          <div className="busy-card cropmarks">{state.busy}…</div>
        </div>
      )}
      {state.error && (
        <div className="toast error" role="alert">
          {state.error}
          <button className="dismiss" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      {state.notice && <div className="toast">{state.notice}</div>}
    </div>
  );
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

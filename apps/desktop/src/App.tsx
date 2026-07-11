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
import { actions, clearError, useAppState } from './state/store';
import { openDroppedFiles, openViaDialog, saveActiveDoc } from './lib/files';
import { Home } from './components/Home';
import { Workspace } from './components/Workspace';

export function App() {
  const state = useAppState();
  const doc = state.docs.find((d) => d.id === state.activeId) ?? null;

  // Keyboard shortcuts (collision-audited table in the build guide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openViaDialog();
      } else if (mod && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        void saveActiveDoc();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        actions.redo();
      } else if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void actions.rotateSelection(90);
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        void actions.extractSelection();
      } else if ((mod && e.key.toLowerCase() === 'd') || e.key === 'Delete') {
        if (e.key === 'Delete' && isEditable(e.target)) return;
        e.preventDefault();
        void actions.deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

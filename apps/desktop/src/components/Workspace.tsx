import { useState } from 'react';
import {
  actions,
  closeDoc,
  setActive,
  useAppState,
  type DocState,
} from '../state/store';
import { openViaDialog, saveActiveDoc } from '../lib/files';
import { ThumbnailGrid } from './ThumbnailGrid';
import { Viewer } from './Viewer';
import { MergeDialog, PageNumbersDialog, SplitDialog, WatermarkDialog } from './dialogs';
import { FormsPanel } from './FormsPanel';
import { SignatureDialog } from './SignatureDialog';

export function Workspace({ doc }: { doc: DocState }) {
  const { docs, selection, viewerPage } = useAppState();
  const [dialog, setDialog] = useState<
    'split' | 'merge' | 'pagenumbers' | 'watermark' | 'sign' | 'initials' | null
  >(null);
  const [formsOpen, setFormsOpen] = useState(false);
  const selCount = selection.length;

  return (
    <div className="workspace">
      {docs.length > 1 && (
        <div className="doc-tabs">
          {docs.map((d) => (
            <button
              key={d.id}
              className={`doc-tab${d.id === doc.id ? ' active' : ''}`}
              onClick={() => setActive(d.id)}
            >
              {d.dirty && <span className="dirty-dot" />}
              <span className="name">{d.fileName}</span>
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDoc(d.id);
                }}
                aria-label={`Close ${d.fileName}`}
              >
                ×
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="topbar">
        <span className="filename" title={doc.fileName}>
          {doc.dirty && <span className="dirty-dot" title="Unsaved changes" />}
          {doc.fileName}
        </span>
        <span className="spacer" />

        <button
          className="btn"
          onClick={() => void actions.rotateSelection(90)}
          title="Rotate 90° clockwise (Ctrl+R)"
        >
          Rotate {selCount ? `${selCount} page${selCount > 1 ? 's' : ''}` : 'all'} <kbd>Ctrl+R</kbd>
        </button>
        <button
          className="btn danger"
          disabled={!selCount}
          onClick={() => void actions.deleteSelection()}
          title="Delete selected pages (Del)"
        >
          Delete <kbd>Del</kbd>
        </button>
        <button className="btn" disabled={docs.length < 2} onClick={() => setDialog('merge')}>
          Merge <kbd>Ctrl+M</kbd>
        </button>
        <button className="btn" onClick={() => setDialog('split')}>
          Split <kbd>Ctrl+Shift+S</kbd>
        </button>
        <CompressMenu />
        <button className="btn" onClick={() => setDialog('pagenumbers')}>
          Page numbers
        </button>
        <button className="btn" onClick={() => setDialog('watermark')} title="Add watermark (Ctrl+Shift+W)">
          Watermark <kbd>Ctrl+Shift+W</kbd>
        </button>
        <button className="btn" onClick={() => setFormsOpen((o) => !o)}>
          Forms
        </button>
        <button className="btn" onClick={() => setDialog('sign')}>
          Sign
        </button>
        <button className="btn" onClick={() => setDialog('initials')}>
          Initials
        </button>
        <span className="spacer" />

        <button className="btn" disabled={!doc.history.length} onClick={() => actions.undo()}>
          Undo <kbd>Ctrl+Z</kbd>
        </button>
        <button className="btn" disabled={!doc.future.length} onClick={() => actions.redo()}>
          Redo
        </button>
        <button className="btn" onClick={() => void openViaDialog()}>
          Open <kbd>Ctrl+O</kbd>
        </button>
        <button className="btn primary" onClick={() => void saveActiveDoc()}>
          Save <kbd>Ctrl+S</kbd>
        </button>
      </div>

      <div className="work-main">
        <ThumbnailGrid doc={doc} />
        {viewerPage !== null && <Viewer doc={doc} page={viewerPage} />}
        {formsOpen && <FormsPanel doc={doc} onClose={() => setFormsOpen(false)} />}
      </div>

      <div className="statusbar">
        <span>{doc.pageCount} pages</span>
        <span>{(doc.bytes.length / 1024 / 1024).toFixed(2)} MB</span>
        {selCount > 0 && <span>{selCount} selected</span>}
        <span className="spacer" />
        <span className="offline">● offline — nothing leaves this machine</span>
      </div>

      {dialog === 'split' && <SplitDialog doc={doc} onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeDialog onClose={() => setDialog(null)} />}
      {dialog === 'pagenumbers' && <PageNumbersDialog onClose={() => setDialog(null)} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setDialog(null)} />}
      {dialog === 'sign' && <SignatureDialog slot="signature" onClose={() => setDialog(null)} />}
      {dialog === 'initials' && <SignatureDialog slot="initials" onClose={() => setDialog(null)} />}
    </div>
  );
}

function CompressMenu() {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        Compress <kbd>Ctrl+Shift+C</kbd>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            zIndex: 30,
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 210,
            boxShadow: 'var(--shadow)',
          }}
        >
          {(
            [
              ['low', 'Low — lossless re-save'],
              ['medium', 'Medium — images to 1600px'],
              ['high', 'High — images to 1000px'],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              className="btn"
              style={{ border: 'none', borderRadius: 0, justifyContent: 'flex-start' }}
              onClick={() => {
                setOpen(false);
                void actions.compress(preset);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

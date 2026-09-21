import { useState } from 'react';
import {
  actions,
  closeDoc,
  closeDialog,
  openDialog,
  setActive,
  setPaletteOpen,
  useAppState,
  type DocState,
} from '../state/store';
import { openViaDialog, saveActiveDoc } from '../lib/files';
import { ThumbnailGrid } from './ThumbnailGrid';
import { Viewer } from './Viewer';
import {
  BatchDialog,
  CompressDialog,
  MergeDialog,
  MetadataDialog,
  NormalizeDialog,
  PageNumbersDialog,
  SplitDialog,
  WatermarkDialog,
} from './dialogs';
import { FormsPanel } from './FormsPanel';
import { SignatureDialog } from './SignatureDialog';
import { ExportMenu, OcrDialog } from './ExportTools';

export function Workspace({ doc }: { doc: DocState }) {
  const { docs, selection, viewerPage, pendingDialog } = useAppState();
  const [formsOpen, setFormsOpen] = useState(false);
  const selCount = selection.length;
  const undoLabel = doc.history[doc.history.length - 1]?.label;
  const redoLabel = doc.future[doc.future.length - 1]?.label;

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
          onClick={() => setPaletteOpen(true)}
          title="Command palette — every action, searchable (Ctrl+K)"
        >
          Commands <kbd>Ctrl+K</kbd>
        </button>

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
        <button
          className="btn"
          disabled={!selCount}
          onClick={() => void actions.extractSelection()}
          title="Extract selected pages to a new document (Ctrl+E)"
        >
          Extract <kbd>Ctrl+E</kbd>
        </button>
        <button className="btn" disabled={docs.length < 2} onClick={() => openDialog('merge')}>
          Merge <kbd>Ctrl+M</kbd>
        </button>
        <button className="btn" onClick={() => openDialog('split')}>
          Split <kbd>Ctrl+Shift+S</kbd>
        </button>
        <button
          className="btn"
          onClick={() => openDialog('compress')}
          title="Compress — presets or a target size (Ctrl+Shift+C)"
        >
          Compress <kbd>Ctrl+Shift+C</kbd>
        </button>
        <button className="btn" onClick={() => openDialog('pagenumbers')}>
          Page numbers
        </button>
        <button
          className="btn"
          onClick={() => openDialog('watermark')}
          title="Add watermark (Ctrl+Shift+W)"
        >
          Watermark <kbd>Ctrl+Shift+W</kbd>
        </button>
        <button className="btn" onClick={() => openDialog('normalize')}>
          Normalize
        </button>
        <button className="btn" onClick={() => openDialog('metadata')}>
          Properties
        </button>
        <button className="btn" onClick={() => openDialog('batch')}>
          Batch
        </button>
        <button className="btn" onClick={() => setFormsOpen((o) => !o)}>
          Forms
        </button>
        <button className="btn" onClick={() => openDialog('sign')}>
          Sign
        </button>
        <button className="btn" onClick={() => openDialog('initials')}>
          Initials
        </button>
        <ExportMenu onOcr={() => openDialog('ocr')} />
        <span className="spacer" />

        <button
          className="btn"
          disabled={!doc.history.length}
          onClick={() => actions.undo()}
          title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
        >
          Undo <kbd>Ctrl+Z</kbd>
        </button>
        <button
          className="btn"
          disabled={!doc.future.length}
          onClick={() => actions.redo()}
          title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
        >
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

      {pendingDialog === 'split' && <SplitDialog doc={doc} onClose={closeDialog} />}
      {pendingDialog === 'merge' && <MergeDialog onClose={closeDialog} />}
      {pendingDialog === 'pagenumbers' && <PageNumbersDialog onClose={closeDialog} />}
      {pendingDialog === 'watermark' && <WatermarkDialog onClose={closeDialog} />}
      {pendingDialog === 'compress' && <CompressDialog doc={doc} onClose={closeDialog} />}
      {pendingDialog === 'normalize' && <NormalizeDialog onClose={closeDialog} />}
      {pendingDialog === 'metadata' && <MetadataDialog doc={doc} onClose={closeDialog} />}
      {pendingDialog === 'batch' && <BatchDialog onClose={closeDialog} />}
      {pendingDialog === 'sign' && <SignatureDialog slot="signature" onClose={closeDialog} />}
      {pendingDialog === 'initials' && <SignatureDialog slot="initials" onClose={closeDialog} />}
      {pendingDialog === 'ocr' && <OcrDialog doc={doc} onClose={closeDialog} />}
    </div>
  );
}

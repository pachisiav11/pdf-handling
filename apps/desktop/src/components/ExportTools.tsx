import { useEffect, useState } from 'react';
import type { OcrPageResult } from '@pdfx/core';
import { exportImagesFlow, exportTextFlow, ocrFlow } from '../lib/convert';
import { saveBytesAs } from '../lib/files';
import type { DocState } from '../state/store';

/** Export dropdown: PDF → images / plain text / OCR. */
export function ExportMenu({ onOcr }: { onOcr: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        Export
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
            minWidth: 230,
            boxShadow: 'var(--shadow)',
          }}
        >
          <button
            className="btn"
            style={{ border: 'none', borderRadius: 0, justifyContent: 'flex-start' }}
            onClick={() => {
              setOpen(false);
              void exportImagesFlow();
            }}
          >
            Pages → PNG images (150dpi)
          </button>
          <button
            className="btn"
            style={{ border: 'none', borderRadius: 0, justifyContent: 'flex-start' }}
            onClick={() => {
              setOpen(false);
              void exportTextFlow();
            }}
          >
            Text → .txt file
          </button>
          <button
            className="btn"
            style={{ border: 'none', borderRadius: 0, justifyContent: 'flex-start' }}
            onClick={() => {
              setOpen(false);
              onOcr();
            }}
          >
            OCR scanned pages…
          </button>
        </div>
      )}
    </span>
  );
}

/** OCR dialog: page-by-page progress, then the recognized text with a save option. */
export function OcrDialog({ doc, onClose }: { doc: DocState; onClose: () => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: doc.pageCount,
  });
  const [results, setResults] = useState<OcrPageResult[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    ocrFlow((done, total) => alive && setProgress({ done, total })).then((res) => {
      if (!alive) return;
      if (res) setResults(res);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullText = results
    ?.map((r) => `--- Page ${r.pageIndex + 1} ---\n${r.text}`)
    .join('\n\n');

  return (
    <div className="dialog-backdrop" onClick={results || failed ? onClose : undefined}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()} style={{ width: 'min(620px, 92vw)' }}>
        <h2>OCR</h2>
        {!results && !failed && (
          <>
            <p className="hint">
              Recognizing text page by page — {progress.done} of {progress.total} done…
            </p>
            <progress value={progress.done} max={progress.total} style={{ width: '100%' }} />
          </>
        )}
        {failed && (
          <p className="hint">OCR did not complete — see the message above for what to fix.</p>
        )}
        {results && (
          <>
            <p className="hint">
              Recognized {results.length} page(s). Review below, then save as text.
            </p>
            <textarea
              className="input"
              readOnly
              value={fullText}
              style={{ height: 260, resize: 'vertical', fontFamily: 'var(--font-mono)' }}
            />
          </>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {results && (
            <button
              className="btn primary"
              onClick={() =>
                void saveBytesAs(
                  doc.fileName.replace(/\.pdf$/i, '-ocr.txt'),
                  new TextEncoder().encode(fullText ?? ''),
                  'txt',
                )
              }
            >
              Save as .txt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

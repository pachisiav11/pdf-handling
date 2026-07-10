import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getRenderDoc, renderPage } from '../pdf/render';
import { setViewerPage, type DocState } from '../state/store';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Single-page viewer with zoom buttons, Ctrl+scroll zoom and page paging. */
export function Viewer({ doc, page }: { doc: DocState; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [renderDoc, setRenderDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [baseWidth, setBaseWidth] = useState(612);

  useEffect(() => {
    let alive = true;
    getRenderDoc(doc.id, doc.version, doc.bytes).then((d) => alive && setRenderDoc(d));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.version, doc.bytes]);

  useEffect(() => {
    if (!renderDoc) return;
    let alive = true;
    renderDoc.getPage(page + 1).then((p) => {
      if (!alive) return;
      const vp = p.getViewport({ scale: 1 });
      // Fit-width baseline against the pane, capped at natural size * 1.4.
      const paneW = wrapRef.current?.clientWidth ?? 800;
      setBaseWidth(Math.min(paneW - 64, vp.width * 1.4));
    });
    return () => {
      alive = false;
    };
  }, [renderDoc, page]);

  useEffect(() => {
    if (!renderDoc || !canvasRef.current) return;
    let alive = true;
    renderPage(renderDoc, page, baseWidth * zoom, canvasRef.current).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [renderDoc, page, zoom, baseWidth, doc.version]);

  const zoomBy = (dir: 1 | -1) => {
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((s) => s >= z - 0.001);
      const next = ZOOM_STEPS[Math.min(Math.max(idx + dir, 0), ZOOM_STEPS.length - 1)];
      return next ?? z;
    });
  };

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <button className="btn" onClick={() => setViewerPage(null)}>
          ← Grid
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="btn"
          disabled={page === 0}
          onClick={() => setViewerPage(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className="mono">
          {page + 1} / {doc.pageCount}
        </span>
        <button
          className="btn"
          disabled={page >= doc.pageCount - 1}
          onClick={() => setViewerPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={() => zoomBy(-1)} aria-label="Zoom out">
          −
        </button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => zoomBy(1)} aria-label="Zoom in">
          +
        </button>
        <button className="btn" onClick={() => setZoom(1)}>
          Reset
        </button>
      </div>
      <div
        ref={wrapRef}
        className="viewer-canvas-wrap"
        onWheel={(e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1 : -1);
          }
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

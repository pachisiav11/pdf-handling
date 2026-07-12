import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { Markup, MarkupKind, Rect, Stamp, Stroke, TextItem } from '@pdfx/core';
import { getRenderDoc, renderPage } from '../pdf/render';
import {
  actions,
  clearStampRequest,
  setViewerPage,
  showNotice,
  useAppState,
  type DocState,
} from '../state/store';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

type EditMode = 'text' | 'draw' | 'highlight' | 'stamp' | 'crop' | 'redact' | 'field' | null;

interface PendingText {
  x: number; // PDF pts (baseline-ish anchor: top-left converted on commit)
  y: number;
  text: string;
  size: number;
}
interface PendingStamp {
  rect: Rect;
  bytes: Uint8Array;
  type: 'png' | 'jpg';
  url: string;
}

/** Page viewer with zoom + an edit overlay (Phase 3 tools). */
export function Viewer({ doc, page }: { doc: DocState; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [renderDoc, setRenderDoc] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [baseWidth, setBaseWidth] = useState(612);
  const [pageSize, setPageSize] = useState({ w: 612, h: 792 });
  const [mode, setMode] = useState<EditMode>(null);
  const [markupKind, setMarkupKind] = useState<MarkupKind>('highlight');
  const [textSize, setTextSize] = useState(14);
  const [strokeWidth, setStrokeWidth] = useState(2);

  // Pending (uncommitted) edits — all in PDF points, bottom-left origin.
  const [texts, setTexts] = useState<PendingText[]>([]);
  const [strokes, setStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [liveStroke, setLiveStroke] = useState<Array<{ x: number; y: number }> | null>(null);
  const [markups, setMarkups] = useState<Rect[][]>([]);
  const [stamp, setStamp] = useState<PendingStamp | null>(null);
  const [rects, setRects] = useState<Rect[]>([]); // crop (max 1) / redact (many)
  const [band, setBand] = useState<Rect | null>(null); // rubber band, CSS px
  const [cropAllPages, setCropAllPages] = useState(true);
  const [confirmRedact, setConfirmRedact] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<{ rect: Rect; name: string; kind: 'text' | 'checkbox' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { stampRequest, redactMode } = useAppState();

  // Global redaction-mode toggle (Ctrl+Shift+R / command palette): mirror it
  // into the viewer's local edit mode so the shortcut actually arms the tool.
  useEffect(() => {
    if (redactMode) setMode('redact');
    else setMode((m) => (m === 'redact' ? null : m));
  }, [redactMode]);

  // Signature/initials placement request from the toolbar dialogs.
  useEffect(() => {
    if (!stampRequest) return;
    const bytes = stampRequest.bytes;
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
    const img = new Image();
    img.onload = () => {
      const w = pageSize.w / (stampRequest.label === 'initials' ? 6 : 3.5);
      const h = w * (img.height / img.width);
      setMode('stamp');
      setStamp({
        rect: { x: pageSize.w / 2 - w / 2, y: pageSize.h / 3, width: w, height: h },
        bytes,
        type: 'png',
        url,
      });
      clearStampRequest();
    };
    img.src = url;
  }, [stampRequest, pageSize.w, pageSize.h]);

  const hasPending =
    texts.length > 0 || strokes.length > 0 || markups.length > 0 || !!stamp || rects.length > 0;

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
      setPageSize({ w: vp.width, h: vp.height });
      const paneW = wrapRef.current?.clientWidth ?? 800;
      setBaseWidth(Math.min(paneW - 64, vp.width * 1.4));
    });
    return () => {
      alive = false;
    };
  }, [renderDoc, page]);

  useEffect(() => {
    if (!renderDoc || !canvasRef.current) return;
    renderPage(renderDoc, page, baseWidth * zoom, canvasRef.current).catch((err) =>
      console.error('[pdfx] viewer render failed:', err),
    );
  }, [renderDoc, page, zoom, baseWidth, doc.version]);

  // Text layer for highlight/underline/strikethrough selection.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!renderDoc || !container || mode !== 'highlight') return;
    let alive = true;
    container.replaceChildren();
    renderDoc.getPage(page + 1).then(async (p) => {
      if (!alive) return;
      const cssScale = (baseWidth * zoom) / p.getViewport({ scale: 1 }).width;
      container.style.setProperty('--scale-factor', String(cssScale));
      const layer = new TextLayer({
        textContentSource: p.streamTextContent(),
        container,
        viewport: p.getViewport({ scale: cssScale }),
      });
      await layer.render();
    });
    return () => {
      alive = false;
      container.replaceChildren();
    };
  }, [renderDoc, page, mode, baseWidth, zoom, doc.version]);

  // ---- coordinate mapping ----
  const cssDims = { w: baseWidth * zoom, h: (baseWidth * zoom * pageSize.h) / pageSize.w };
  const cssToPdf = useCallback(
    (px: number, py: number) => ({
      x: (px / cssDims.w) * pageSize.w,
      y: pageSize.h - (py / cssDims.h) * pageSize.h,
    }),
    [cssDims.w, cssDims.h, pageSize.w, pageSize.h],
  );
  const pdfRectToCss = useCallback(
    (r: Rect) => ({
      left: (r.x / pageSize.w) * cssDims.w,
      top: ((pageSize.h - r.y - r.height) / pageSize.h) * cssDims.h,
      width: (r.width / pageSize.w) * cssDims.w,
      height: (r.height / pageSize.h) * cssDims.h,
    }),
    [cssDims.w, cssDims.h, pageSize.w, pageSize.h],
  );

  const overlayPoint = (e: React.PointerEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  // ---- pointer interactions per mode ----
  const dragStart = useRef<{ px: number; py: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!mode || mode === 'highlight') return;
    const { px, py } = overlayPoint(e);
    if (mode === 'text') {
      const p = cssToPdf(px, py);
      setTexts((t) => [...t, { x: p.x, y: p.y, text: '', size: textSize }]);
    } else if (mode === 'draw') {
      overlayRef.current!.setPointerCapture(e.pointerId);
      const p = cssToPdf(px, py);
      setLiveStroke([p]);
    } else if (mode === 'crop' || mode === 'redact' || mode === 'field') {
      overlayRef.current!.setPointerCapture(e.pointerId);
      dragStart.current = { px, py };
      setBand({ x: px, y: py, width: 0, height: 0 });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!mode) return;
    const { px, py } = overlayPoint(e);
    if (mode === 'draw' && liveStroke) {
      const p = cssToPdf(px, py);
      setLiveStroke((s) => (s ? [...s, p] : s));
    } else if ((mode === 'crop' || mode === 'redact' || mode === 'field') && dragStart.current) {
      const s = dragStart.current;
      setBand({
        x: Math.min(s.px, px),
        y: Math.min(s.py, py),
        width: Math.abs(px - s.px),
        height: Math.abs(py - s.py),
      });
    }
  };

  const onPointerUp = () => {
    if (mode === 'draw' && liveStroke) {
      if (liveStroke.length > 1) setStrokes((s) => [...s, liveStroke]);
      setLiveStroke(null);
    } else if ((mode === 'crop' || mode === 'redact' || mode === 'field') && band && dragStart.current) {
      if (band.width > 4 && band.height > 4) {
        const tl = cssToPdf(band.x, band.y);
        const br = cssToPdf(band.x + band.width, band.y + band.height);
        const pdfRect: Rect = { x: tl.x, y: br.y, width: br.x - tl.x, height: tl.y - br.y };
        if (mode === 'field') {
          setFieldDraft({ rect: pdfRect, name: '', kind: 'text' });
        } else {
          setRects((r) => (mode === 'crop' ? [pdfRect] : [...r, pdfRect]));
        }
      }
      setBand(null);
      dragStart.current = null;
    }
  };

  // Highlight: capture the text-layer selection on mouseup.
  const onTextLayerMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !overlayRef.current) return;
    const overlayBox = overlayRef.current.getBoundingClientRect();
    const out: Rect[] = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      for (const cr of Array.from(sel.getRangeAt(i).getClientRects())) {
        if (cr.width < 2 || cr.height < 2) continue;
        const tl = cssToPdf(cr.left - overlayBox.left, cr.top - overlayBox.top);
        const br = cssToPdf(cr.right - overlayBox.left, cr.bottom - overlayBox.top);
        out.push({ x: tl.x, y: br.y, width: br.x - tl.x, height: tl.y - br.y });
      }
    }
    if (out.length) {
      setMarkups((m) => [...m, out]);
      sel.removeAllRanges();
    }
  };

  const pickStampImage = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = file.type === 'image/png' ? 'png' : 'jpg';
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: file.type }));
    const w = pageSize.w / 3;
    setStamp({
      rect: { x: pageSize.w / 2 - w / 2, y: pageSize.h / 2 - w / 4, width: w, height: w / 2 },
      bytes,
      type,
      url,
    });
  };

  // ---- commit / discard ----
  const apply = async () => {
    if (mode === 'text' && texts.length) {
      const items: TextItem[] = texts
        .filter((t) => t.text.trim())
        .map((t) => ({ pageIndex: page, x: t.x, y: t.y - t.size, text: t.text, size: t.size }));
      if (items.length) await actions.applyText(items);
    } else if (mode === 'draw' && strokes.length) {
      const items: Stroke[] = strokes.map((points) => ({ pageIndex: page, points, width: strokeWidth }));
      await actions.applyStrokes(items);
    } else if (mode === 'highlight' && markups.length) {
      const items: Markup[] = markups.map((rects) => ({ pageIndex: page, kind: markupKind, rects }));
      await actions.applyMarkups(items);
    } else if (mode === 'stamp' && stamp) {
      const item: Stamp = { pageIndex: page, imageBytes: stamp.bytes, imageType: stamp.type, rect: stamp.rect };
      await actions.applyStamps([item]);
      URL.revokeObjectURL(stamp.url);
    } else if (mode === 'crop' && rects.length) {
      await actions.applyCrop(rects[0]!, cropAllPages ? undefined : [page]);
    } else if (mode === 'redact' && rects.length) {
      setConfirmRedact(true);
      return; // confirmed in dialog
    }
    discard(false);
  };

  const confirmAndRedact = async () => {
    setConfirmRedact(false);
    await actions.applyRedaction([{ pageIndex: page, rects }]);
    showNotice('Redacted. This page is now an image and no longer searchable.');
    discard(false);
  };

  const discard = (fully = true) => {
    setTexts([]);
    setStrokes([]);
    setLiveStroke(null);
    setMarkups([]);
    if (stamp) URL.revokeObjectURL(stamp.url);
    setStamp(null);
    setRects([]);
    setBand(null);
    if (fully) setMode(null);
  };

  const zoomBy = (dir: 1 | -1) => {
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((s) => s >= z - 0.001);
      const next = ZOOM_STEPS[Math.min(Math.max(idx + dir, 0), ZOOM_STEPS.length - 1)];
      return next ?? z;
    });
  };

  const toolBtn = (m: Exclude<EditMode, null>, label: string) => (
    <button
      className={`btn${mode === m ? ' primary' : ''}`}
      onClick={() => {
        if (mode === m) {
          discard();
        } else {
          discard(false);
          setMode(m);
          if (m === 'stamp') fileInputRef.current?.click();
        }
      }}
    >
      {label}
    </button>
  );

  const stampCss = stamp ? pdfRectToCss(stamp.rect) : null;

  return (
    <div className="viewer">
      <div className="viewer-bar">
        <button className="btn" onClick={() => setViewerPage(null)}>← Grid</button>
        <button className="btn" disabled={page === 0} onClick={() => setViewerPage(page - 1)} aria-label="Previous page">‹</button>
        <span className="mono">{page + 1} / {doc.pageCount}</span>
        <button className="btn" disabled={page >= doc.pageCount - 1} onClick={() => setViewerPage(page + 1)} aria-label="Next page">›</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button className="btn" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
      </div>

      <div className="viewer-bar">
        {toolBtn('text', 'Text')}
        {toolBtn('draw', 'Draw')}
        {toolBtn('highlight', 'Markup')}
        {toolBtn('stamp', 'Image')}
        {toolBtn('crop', 'Crop')}
        {toolBtn('redact', 'Redact')}
        {toolBtn('field', 'Field')}
        {mode === 'highlight' && (
          <select className="select" value={markupKind} onChange={(e) => setMarkupKind(e.target.value as MarkupKind)}>
            <option value="highlight">Highlight</option>
            <option value="underline">Underline</option>
            <option value="strikethrough">Strikethrough</option>
          </select>
        )}
        {mode === 'text' && (
          <select className="select" value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}>
            {[10, 12, 14, 18, 24, 32].map((s) => <option key={s} value={s}>{s} pt</option>)}
          </select>
        )}
        {mode === 'draw' && (
          <select className="select" value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))}>
            {[1, 2, 4, 6].map((s) => <option key={s} value={s}>{s} pt</option>)}
          </select>
        )}
        {mode === 'crop' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={cropAllPages} onChange={(e) => setCropAllPages(e.target.checked)} />
            All pages
          </label>
        )}
        {mode && (
          <>
            <span style={{ flex: 1 }} />
            <button className="btn primary" disabled={!hasPending} onClick={() => void apply()}>
              Apply {mode === 'redact' && rects.length ? `${rects.length} redaction${rects.length > 1 ? 's' : ''}` : ''}
            </button>
            <button className="btn" onClick={() => discard()}>Cancel</button>
          </>
        )}
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
        <div className="page-stage" style={{ width: cssDims.w, height: cssDims.h }}>
          <canvas ref={canvasRef} />
          {/* pdf.js text layer (highlight mode) */}
          <div
            ref={textLayerRef}
            className="textLayer"
            style={{ display: mode === 'highlight' ? 'block' : 'none' }}
            onMouseUp={onTextLayerMouseUp}
          />
          {/* edit overlay */}
          {mode && mode !== 'highlight' && (
            <div
              ref={overlayRef}
              className={`edit-overlay mode-${mode}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* pending texts */}
              {texts.map((t, i) => {
                const css = pdfRectToCss({ x: t.x, y: t.y - t.size, width: 10, height: t.size });
                return (
                  <input
                    key={i}
                    className="pending-text"
                    style={{ left: css.left, top: css.top, fontSize: (t.size / pageSize.w) * cssDims.w }}
                    value={t.text}
                    placeholder="Type…"
                    autoFocus={i === texts.length - 1}
                    onChange={(e) => setTexts((arr) => arr.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                );
              })}
              {/* strokes preview */}
              <svg className="stroke-preview">
                {[...strokes, ...(liveStroke ? [liveStroke] : [])].map((pts, i) => (
                  <polyline
                    key={i}
                    points={pts
                      .map((p) => {
                        const c = pdfRectToCss({ x: p.x, y: p.y, width: 0, height: 0 });
                        return `${c.left},${c.top}`;
                      })
                      .join(' ')}
                    fill="none"
                    stroke="#1b1b1b"
                    strokeWidth={(strokeWidth / pageSize.w) * cssDims.w}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </svg>
              {/* stamp preview */}
              {stamp && stampCss && (
                <StampBox
                  css={stampCss}
                  url={stamp.url}
                  onMove={(dx, dy) =>
                    setStamp((s) => {
                      if (!s) return s;
                      const scaleX = pageSize.w / cssDims.w;
                      return { ...s, rect: { ...s.rect, x: s.rect.x + dx * scaleX, y: s.rect.y - dy * scaleX } };
                    })
                  }
                  onResize={(dw) =>
                    setStamp((s) => {
                      if (!s) return s;
                      const scaleX = pageSize.w / cssDims.w;
                      const ratio = s.rect.height / s.rect.width;
                      const nw = Math.max(20, s.rect.width + dw * scaleX);
                      return { ...s, rect: { ...s.rect, width: nw, height: nw * ratio } };
                    })
                  }
                />
              )}
              {/* crop/redact rects */}
              {rects.map((r, i) => {
                const css = pdfRectToCss(r);
                return (
                  <div
                    key={i}
                    className={mode === 'crop' ? 'crop-rect cropmarks' : 'redact-rect'}
                    style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={() => setRects((arr) => arr.filter((_, j) => j !== i))}
                    title="Double-click to remove"
                  />
                );
              })}
              {band && (
                <div
                  className={mode === 'redact' ? 'redact-rect' : 'crop-rect cropmarks'}
                  style={{ left: band.x, top: band.y, width: band.width, height: band.height }}
                />
              )}
            </div>
          )}
          {/* committed markup preview hint */}
          {mode === 'highlight' && markups.length > 0 && (
            <div className="markup-count mono">{markups.length} selection(s) pending</div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickStampImage(f);
          e.target.value = '';
        }}
      />

      {fieldDraft && (
        <div className="dialog-backdrop" onClick={() => setFieldDraft(null)}>
          <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
            <h2>New form field</h2>
            <label>Type</label>
            <select
              className="select"
              value={fieldDraft.kind}
              onChange={(e) => setFieldDraft({ ...fieldDraft, kind: e.target.value as 'text' | 'checkbox' })}
            >
              <option value="text">Text field</option>
              <option value="checkbox">Checkbox</option>
            </select>
            <label>Field name</label>
            <input
              className="input"
              value={fieldDraft.name}
              placeholder="e.g. customer.name"
              autoFocus
              onChange={(e) => setFieldDraft({ ...fieldDraft, name: e.target.value })}
            />
            <div className="row">
              <button className="btn" onClick={() => setFieldDraft(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!fieldDraft.name.trim()}
                onClick={() => {
                  void actions.createFields([
                    { kind: fieldDraft.kind, name: fieldDraft.name.trim(), pageIndex: page, rect: fieldDraft.rect },
                  ]);
                  setFieldDraft(null);
                  discard(false);
                }}
              >
                Create field
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRedact && (
        <div className="dialog-backdrop" onClick={() => setConfirmRedact(false)}>
          <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
            <h2>Redact {rects.length} area{rects.length > 1 ? 's' : ''}?</h2>
            <p className="hint">
              Redaction permanently removes the content under the black boxes — it is not just
              covered up. The redacted page becomes an image: larger file, and its text is no
              longer selectable or searchable.
            </p>
            <div className="row">
              <button className="btn" onClick={() => setConfirmRedact(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void confirmAndRedact()}>Redact permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StampBox({
  css,
  url,
  onMove,
  onResize,
}: {
  css: { left: number; top: number; width: number; height: number };
  url: string;
  onMove: (dx: number, dy: number) => void;
  onResize: (dw: number) => void;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const resizing = useRef(false);
  return (
    <div
      className="stamp-box cropmarks"
      style={{ left: css.left, top: css.top, width: css.width, height: css.height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        last.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        if (resizing.current) onResize(dx);
        else onMove(dx, dy);
      }}
      onPointerUp={() => {
        last.current = null;
        resizing.current = false;
      }}
    >
      <img src={url} alt="Stamp preview" draggable={false} />
      <div
        className="stamp-resize"
        onPointerDown={(e) => {
          e.stopPropagation();
          resizing.current = true;
          last.current = { x: e.clientX, y: e.clientY };
          (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
        }}
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { NumberPosition, PaperSize } from '@pdfx/core';
import { getTitle, runBatch, type BatchItem } from '@pdfx/core';
import { ops } from '../pdf/opsClient';
import { actions, runExportOp, showNotice, useAppState, type DocState } from '../state/store';
import { saveBytesAs } from '../lib/files';
import { zipSync } from 'fflate';

/** Split dialog: extract a range to a new PDF, or every page to a zip. */
export function SplitDialog({ doc, onClose }: { doc: DocState; onClose: () => void }) {
  const [range, setRange] = useState('');
  const [mode, setMode] = useState<'range' | 'all'>('range');
  const base = doc.fileName.replace(/\.pdf$/i, '');

  const run = async () => {
    if (mode === 'range') {
      const bytes = await runExportOp('Splitting', () => ops.splitRange(doc.bytes, range));
      if (bytes) {
        onClose();
        await saveBytesAs(`${base}-pages-${range.replace(/[^0-9,-]/g, '')}.pdf`, bytes, 'pdf');
      }
    } else {
      const bytes = await runExportOp('Splitting to single pages', () =>
        ops.splitAll(doc.bytes, base),
      );
      if (bytes) {
        onClose();
        await saveBytesAs(`${base}-pages.zip`, bytes, 'zip');
      }
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Split</h2>
        <p className="hint">
          {doc.fileName} · {doc.pageCount} pages
        </p>
        <label>
          <input
            type="radio"
            checked={mode === 'range'}
            onChange={() => setMode('range')}
          />{' '}
          Extract a page range
        </label>
        {mode === 'range' && (
          <input
            className="input"
            placeholder="e.g. 1-3,5,8-10"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            autoFocus
          />
        )}
        <label>
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> Every page
          as its own PDF (zip)
        </label>
        <div className="row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={mode === 'range' && !range.trim()}
            onClick={() => void run()}
          >
            Split &amp; save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Page numbers dialog: position preset + format string. */
export function PageNumbersDialog({ onClose }: { onClose: () => void }) {
  const [position, setPosition] = useState<NumberPosition>('bottom-center');
  const [format, setFormat] = useState('Page {n} of {total}');

  const run = async () => {
    await actions.applyPageNumbers({ position, format });
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Add page numbers</h2>
        <label>Position</label>
        <select className="select" value={position} onChange={(e) => setPosition(e.target.value as NumberPosition)}>
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="top-center">Top center</option>
          <option value="top-right">Top right</option>
          <option value="top-left">Top left</option>
        </select>
        <label>Format — {'{n}'} is the page, {'{total}'} the count</label>
        <input className="input" value={format} onChange={(e) => setFormat(e.target.value)} />
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => void run()}>Add numbers</button>
        </div>
      </div>
    </div>
  );
}

/** Watermark dialog: diagonal text or image on every page. */
export function WatermarkDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [opacity, setOpacity] = useState(0.15);
  const [image, setImage] = useState<{ bytes: Uint8Array; type: 'png' | 'jpg'; name: string } | null>(null);

  const run = async () => {
    if (kind === 'text') {
      await actions.applyWatermark({ text, opacity });
    } else if (image) {
      await actions.applyWatermark({ imageBytes: image.bytes, imageType: image.type, opacity });
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Add watermark</h2>
        <p className="hint">Applied diagonally to every page.</p>
        <label>
          <input type="radio" checked={kind === 'text'} onChange={() => setKind('text')} /> Text
        </label>
        {kind === 'text' && (
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        )}
        <label>
          <input type="radio" checked={kind === 'image'} onChange={() => setKind('image')} /> Image
        </label>
        {kind === 'image' && (
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setImage({
                bytes: new Uint8Array(await f.arrayBuffer()),
                type: f.type === 'image/png' ? 'png' : 'jpg',
                name: f.name,
              });
            }}
          />
        )}
        <label>Opacity — {Math.round(opacity * 100)}%</label>
        <input
          type="range"
          min={5}
          max={60}
          value={opacity * 100}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
        />
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={kind === 'text' ? !text.trim() : !image}
            onClick={() => void run()}
          >
            Apply watermark
          </button>
        </div>
      </div>
    </div>
  );
}

/** Merge dialog: order the open documents, merge into a new PDF, save. */
export function MergeDialog({ onClose }: { onClose: () => void }) {
  const { docs } = useAppState();
  const [order, setOrder] = useState<string[]>(docs.map((d) => d.id));
  const [normalize, setNormalize] = useState(false);
  const [size, setSize] = useState<PaperSize>('a4');

  const move = (id: string, dir: -1 | 1) => {
    setOrder((cur) => {
      const i = cur.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const run = async () => {
    const sources = order
      .map((id) => docs.find((d) => d.id === id))
      .filter((d): d is DocState => !!d)
      .map((d) => d.bytes);
    const bytes = await runExportOp('Merging', async () => {
      const merged = await ops.merge(sources);
      return normalize ? ops.normalize(merged, size) : merged;
    });
    if (bytes) {
      onClose();
      const saved = await saveBytesAs('merged.pdf', bytes, 'pdf');
      if (saved) showNotice(`Merged ${sources.length} documents.`);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Merge</h2>
        <p className="hint">Documents merge top to bottom — reorder before merging.</p>
        <ul className="merge-list">
          {order.map((id) => {
            const d = docs.find((x) => x.id === id);
            if (!d) return null;
            return (
              <li key={id}>
                <span className="name">{d.fileName}</span>
                <span className="mono">{d.pageCount}p</span>
                <span className="updown">
                  <button onClick={() => move(id, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button onClick={() => move(id, 1)} aria-label="Move down">
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => setNormalize(e.target.checked)}
          />
          Normalize every page to a uniform size
        </label>
        {normalize && (
          <select className="select" value={size} onChange={(e) => setSize(e.target.value as PaperSize)}>
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
          </select>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={order.length < 2} onClick={() => void run()}>
            Merge &amp; save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Document properties — title only for v1.1 (build guide). */
export function MetadataDialog({ doc, onClose }: { doc: DocState; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getTitle(doc.bytes).then((t) => {
      if (alive) {
        setTitle(t);
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [doc.bytes]);

  const run = async () => {
    await actions.setTitle(title);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Document properties</h2>
        <p className="hint">Only the title is editable in this version.</p>
        <label>Title</label>
        <input
          className="input"
          value={title}
          placeholder={loaded ? '(no title set)' : 'Loading…'}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!loaded} onClick={() => void run()}>
            Save title
          </button>
        </div>
      </div>
    </div>
  );
}

/** Standalone page-size normalize. */
export function NormalizeDialog({ onClose }: { onClose: () => void }) {
  const [size, setSize] = useState<PaperSize>('a4');
  const run = async () => {
    await actions.normalize(size);
    onClose();
  };
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Normalize page size</h2>
        <p className="hint">
          Rescales every page to a uniform size, centering content and preserving aspect ratio.
        </p>
        <label>Target size</label>
        <select className="select" value={size} onChange={(e) => setSize(e.target.value as PaperSize)}>
          <option value="a4">A4</option>
          <option value="letter">US Letter</option>
        </select>
        <div className="row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void run()}>
            Normalize
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compress dialog: three presets, or a target size via binary search (Phase 9). */
export function CompressDialog({ doc, onClose }: { doc: DocState; onClose: () => void }) {
  const [mode, setMode] = useState<'preset' | 'target'>('preset');
  const [preset, setPreset] = useState<'low' | 'medium' | 'high'>('medium');
  const currentMb = doc.bytes.length / (1024 * 1024);
  const [targetMb, setTargetMb] = useState(Math.max(0.1, +(currentMb * 0.5).toFixed(1)));

  const run = async () => {
    onClose();
    if (mode === 'preset') await actions.compress(preset);
    else await actions.compressToTarget(Math.round(targetMb * 1024 * 1024));
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>Compress</h2>
        <p className="hint">Current size: {currentMb.toFixed(2)} MB</p>
        <label>
          <input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} /> Preset
        </label>
        {mode === 'preset' && (
          <select
            className="select"
            value={preset}
            onChange={(e) => setPreset(e.target.value as 'low' | 'medium' | 'high')}
          >
            <option value="low">Low — lossless re-save</option>
            <option value="medium">Medium — images to 1600px</option>
            <option value="high">High — images to 1000px</option>
          </select>
        )}
        <label>
          <input type="radio" checked={mode === 'target'} onChange={() => setMode('target')} /> Target
          size
        </label>
        {mode === 'target' && (
          <>
            <label>Target — {targetMb.toFixed(1)} MB</label>
            <input
              type="number"
              className="input"
              min={0.1}
              step={0.1}
              value={targetMb}
              onChange={(e) => setTargetMb(Math.max(0.1, Number(e.target.value)))}
            />
            <p className="hint">
              Searches for the highest quality that fits under this size; tells you if it can’t.
            </p>
          </>
        )}
        <div className="row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void run()}>
            Compress
          </button>
        </div>
      </div>
    </div>
  );
}

type BatchOp = 'compress-medium' | 'compress-high' | 'rotate90' | 'normalize-a4' | 'watermark';

const BATCH_OPS: Array<{ id: BatchOp; label: string }> = [
  { id: 'compress-medium', label: 'Compress (medium)' },
  { id: 'compress-high', label: 'Compress (high)' },
  { id: 'rotate90', label: 'Rotate all pages 90°' },
  { id: 'normalize-a4', label: 'Normalize to A4' },
  { id: 'watermark', label: 'Watermark "DRAFT"' },
];

/**
 * Multi-file batch: pick N PDFs, choose ONE operation, apply to all via a
 * bounded worker pool, show per-file status, and save the results as a zip.
 * Distinct from merge (which combines into one output).
 */
export function BatchDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<Array<{ name: string; bytes: Uint8Array }>>([]);
  const [op, setOp] = useState<BatchOp>('compress-medium');
  const [items, setItems] = useState<BatchItem<{ name: string; bytes: Uint8Array }, Uint8Array>[]>([]);
  const [running, setRunning] = useState(false);
  const [doneSummary, setDoneSummary] = useState<string | null>(null);

  const pick = async () => {
    const picked = await window.pdfx.openPdfs();
    setFiles(picked.map((f) => ({ name: f.fileName, bytes: new Uint8Array(f.bytes) })));
    setItems([]);
    setDoneSummary(null);
  };

  const applyOp = (bytes: Uint8Array): Promise<Uint8Array> => {
    switch (op) {
      case 'compress-medium':
        return ops.compress(bytes, 'medium');
      case 'compress-high':
        return ops.compress(bytes, 'high');
      case 'rotate90':
        return ops.rotatePages(bytes, 90);
      case 'normalize-a4':
        return ops.normalize(bytes, 'a4');
      case 'watermark':
        return ops.watermark(bytes, { text: 'DRAFT', opacity: 0.15 });
    }
  };

  const run = async () => {
    if (!files.length) return;
    setRunning(true);
    setDoneSummary(null);
    setItems(files.map((f, index) => ({ index, input: f, status: 'queued' })));
    const summary = await runBatch(files, (f) => applyOp(f.bytes), {
      concurrency: 2, // the ops worker serializes; keep the queue bounded and responsive
      onUpdate: (item) => {
        // reflect this item's new status in the UI (copy — never store the live ref)
        setItems((prev) =>
          prev.map((p) =>
            p.index === item.index ? { ...p, status: item.status, error: item.error } : p,
          ),
        );
      },
    });
    setRunning(false);

    const suffix = op.startsWith('compress')
      ? 'compressed'
      : op === 'rotate90'
        ? 'rotated'
        : op === 'normalize-a4'
          ? 'a4'
          : 'draft';
    const entries: Record<string, Uint8Array> = {};
    for (const it of summary.items) {
      if (it.status === 'done' && it.result) {
        const base = it.input.name.replace(/\.pdf$/i, '');
        entries[`${base}-${suffix}.pdf`] = it.result;
      }
    }
    setDoneSummary(
      `${summary.succeeded} succeeded, ${summary.failed} failed` +
        (summary.failed
          ? `: ${summary.items.filter((i) => i.status === 'failed').map((i) => i.input.name).join(', ')}`
          : '.'),
    );
    if (Object.keys(entries).length) {
      await saveBytesAs(`batch-${suffix}.zip`, zipSync(entries, { level: 0 }), 'zip');
    }
  };

  return (
    <div className="dialog-backdrop" onClick={running ? undefined : onClose}>
      <div
        className="dialog cropmarks"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 92vw)' }}
      >
        <h2>Batch process</h2>
        <p className="hint">
          Apply one operation to many PDFs. Results are saved together as a zip. A failed file never
          aborts the rest.
        </p>
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <button className="btn" onClick={() => void pick()} disabled={running}>
            Choose PDFs…
          </button>
          <span className="hint">{files.length ? `${files.length} file(s) selected` : 'none'}</span>
        </div>
        <label>Operation</label>
        <select className="select" value={op} onChange={(e) => setOp(e.target.value as BatchOp)} disabled={running}>
          {BATCH_OPS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {items.length > 0 && (
          <ul className="merge-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
            {items.map((it) => (
              <li key={it.index}>
                <span className="name">{it.input.name}</span>
                <span className="mono">
                  {it.status === 'failed' ? `failed: ${it.error ?? ''}` : it.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        {doneSummary && <p className="hint">{doneSummary}</p>}
        <div className="row">
          <button className="btn" onClick={onClose} disabled={running}>
            Close
          </button>
          <button
            className="btn primary"
            disabled={!files.length || running}
            onClick={() => void run()}
          >
            {running ? 'Processing…' : 'Run batch'}
          </button>
        </div>
      </div>
    </div>
  );
}

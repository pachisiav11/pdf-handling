import { useState } from 'react';
import type { NumberPosition } from '@pdfx/core';
import { ops } from '../pdf/opsClient';
import { actions, runExportOp, showNotice, useAppState, type DocState } from '../state/store';
import { saveBytesAs } from '../lib/files';

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
    const bytes = await runExportOp('Merging', () => ops.merge(sources));
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

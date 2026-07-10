import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getRenderDoc, renderPage } from '../pdf/render';
import { actions, setSelection, setViewerPage, useAppState, type DocState } from '../state/store';

const THUMB_WIDTH = 150;

/**
 * Virtualized page grid: each cell renders its canvas only while near the
 * viewport (IntersectionObserver), so 500-page docs open without stalling.
 * Drag a cell to reorder; click selects; double-click opens the viewer.
 */
export function ThumbnailGrid({ doc }: { doc: DocState }) {
  const { selection } = useAppState();
  const [renderDoc, setRenderDoc] = useState<PDFDocumentProxy | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null);
  const lastClicked = useRef<number>(0);

  useEffect(() => {
    let alive = true;
    getRenderDoc(doc.id, doc.version, doc.bytes).then((d) => {
      if (alive) setRenderDoc(d);
    });
    return () => {
      alive = false;
    };
  }, [doc.id, doc.version, doc.bytes]);

  const onCellClick = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey) {
      const a = Math.min(lastClicked.current, i);
      const b = Math.max(lastClicked.current, i);
      setSelection(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      setSelection(
        selection.includes(i) ? selection.filter((s) => s !== i) : [...selection, i].sort((x, y) => x - y),
      );
      lastClicked.current = i;
    } else {
      setSelection(selection.length === 1 && selection[0] === i ? [] : [i]);
      lastClicked.current = i;
    }
  };

  const commitDrop = () => {
    if (dragFrom === null || dropAt === null) return;
    let target = dropAt.index + (dropAt.after ? 1 : 0);
    if (target > dragFrom) target -= 1;
    if (target !== dragFrom) {
      const order = Array.from({ length: doc.pageCount }, (_, k) => k);
      order.splice(dragFrom, 1);
      order.splice(target, 0, dragFrom);
      void actions.reorder(order);
    }
    setDragFrom(null);
    setDropAt(null);
  };

  return (
    <div className="thumb-pane">
      <div className="thumb-grid">
        {Array.from({ length: doc.pageCount }, (_, i) => (
          <Thumb
            key={`${doc.version}-${i}`}
            index={i}
            renderDoc={renderDoc}
            selected={selection.includes(i)}
            dropMarker={dropAt?.index === i ? (dropAt.after ? 'after' : 'before') : null}
            onClick={(e) => onCellClick(i, e)}
            onDoubleClick={() => setViewerPage(i)}
            onDragStart={() => setDragFrom(i)}
            onDragOverCell={(after) => setDropAt({ index: i, after })}
            onDrop={commitDrop}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

interface ThumbProps {
  index: number;
  renderDoc: PDFDocumentProxy | null;
  selected: boolean;
  dropMarker: 'before' | 'after' | null;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDragStart: () => void;
  onDragOverCell: (after: boolean) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const Thumb = memo(function Thumb({
  index,
  renderDoc,
  selected,
  dropMarker,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOverCell,
  onDrop,
  onDragEnd,
}: ThumbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || rendered || !renderDoc || !canvasRef.current) return;
    let alive = true;
    renderPage(renderDoc, index, THUMB_WIDTH, canvasRef.current)
      .then(() => alive && setRendered(true))
      .catch((err) => console.error(`[pdfx] thumbnail ${index + 1} render failed:`, err));
    return () => {
      alive = false;
    };
  }, [visible, rendered, renderDoc, index]);

  return (
    <div
      ref={ref}
      className={[
        'thumb cropmarks',
        selected ? 'selected' : '',
        dropMarker === 'before' ? 'drop-before' : '',
        dropMarker === 'after' ? 'drop-after' : '',
      ].join(' ')}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverCell(e.clientX > rect.left + rect.width / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <canvas ref={canvasRef} style={{ display: rendered ? 'block' : 'none' }} />
      {!rendered && <div className="thumb-placeholder" style={{ aspectRatio: '0.773' }} />}
      <span className="pageno">{index + 1}</span>
    </div>
  );
});

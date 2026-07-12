import { describe, expect, it } from 'vitest';
import { DocumentHistory } from '../src/history';
import { runBatch } from '../src/batch';
import { compressToTargetSize, qualityKnobToImageOpts } from '../src/compress';
import { createNodeReencoder } from '../src/reencode-node';
import { normalizePageSize } from '../src/normalize';
import { getTitle, setTitle } from '../src/metadata';
import { addSearchableTextLayer } from '../src/convert/searchableOcr';
import type { OcrPageResult } from '../src/convert/ocr';
import { rotatePages } from '../src/rotate';
import { deletePages } from '../src/pages';
import { addWatermark } from '../src/editing/watermark';
import { getPageCount, loadPdf } from '../src/load';
import { extractPlainText } from '../src/convert/textExtract';
import { textPdf, imagePdf, mixedSizePdf } from './fixtures';

describe('DocumentHistory (full session undo/redo)', () => {
  it('steps back through a real multi-op sequence (rotate → delete → watermark → undo x3)', async () => {
    const original = await textPdf();
    const history = new DocumentHistory(original);

    const rotated = await rotatePages(history.current, 90, [0]);
    history.push('Rotate page 1', rotated);

    const deleted = await deletePages(history.current, [2]);
    history.push('Delete page 3', deleted);

    const watermarked = await addWatermark(history.current, { text: 'DRAFT' });
    history.push('Watermark', watermarked);

    // 5 → after delete → 4 pages, watermark keeps count
    expect(await getPageCount(history.current)).toBe(4);
    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('Watermark');

    history.undo(); // undo watermark
    expect(await getPageCount(history.current)).toBe(4);
    history.undo(); // undo delete → back to 5 pages
    expect(await getPageCount(history.current)).toBe(5);
    history.undo(); // undo rotate → back to original bytes

    expect(history.canUndo).toBe(false);
    expect(history.current).toEqual(original);
    expect(history.canRedo).toBe(true);
    expect(history.redoLabel).toBe('Rotate page 1');
  });

  it('a new push after undo forks history (clears redo)', async () => {
    const history = new DocumentHistory(await textPdf());
    history.push('a', await rotatePages(history.current, 90));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.push('b', await rotatePages(history.current, 180));
    expect(history.canRedo).toBe(false);
  });

  it('enforces the entry-count budget by dropping oldest states', async () => {
    const base = await textPdf();
    const history = new DocumentHistory(base, { maxEntries: 3 });
    for (let i = 0; i < 10; i++) history.push(`op ${i}`, await rotatePages(history.current, 90));
    // Only 3 states retained → at most 2 undos available.
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(2);
  });
});

describe('runBatch (bounded worker pool)', () => {
  it('handles a batch with a deliberately-corrupt file without aborting the rest', async () => {
    const good = await textPdf();
    const corrupt = new Uint8Array([1, 2, 3, 4]); // not a PDF
    const inputs = [good, corrupt, good, good];

    const seen: string[] = [];
    const summary = await runBatch(
      inputs,
      async (bytes) => getPageCount(bytes),
      { concurrency: 2, onUpdate: (item) => seen.push(`${item.index}:${item.status}`) },
    );

    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.items[1]!.status).toBe('failed');
    expect(summary.items[1]!.error).toBeTruthy();
    expect(summary.items[0]!.result).toBe(5);
    // every item reached a terminal state
    expect(summary.items.every((i) => i.status === 'done' || i.status === 'failed')).toBe(true);
  });

  it('never runs more than `concurrency` jobs at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const inputs = Array.from({ length: 12 }, (_, i) => i);
    await runBatch(
      inputs,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
      { concurrency: 3 },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('compressToTargetSize (binary search)', () => {
  it('gets within a reasonable margin of a requested size on an image PDF', async () => {
    const src = await imagePdf();
    const target = Math.round(src.length * 0.5); // ask for ~half
    const res = await compressToTargetSize(src, target, createNodeReencoder());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.size).toBeLessThanOrEqual(target);
      // close to target, not absurdly under (knob search should climb toward it)
      expect(res.size).toBeGreaterThan(target * 0.2);
    }
  });

  it('reports plainly when even max compression cannot reach the target', async () => {
    const src = await imagePdf();
    const res = await compressToTargetSize(src, 1024, createNodeReencoder()); // 1KB, impossible
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toMatch(/smallest possible/i);
      expect(res.smallestBytes.length).toBe(res.smallestSize);
    }
  });

  it('quality knob maps monotonically (lower knob → smaller dimension cap)', () => {
    expect(qualityKnobToImageOpts(0).maxDimension).toBeLessThan(
      qualityKnobToImageOpts(1).maxDimension,
    );
  });
});

describe('normalizePageSize', () => {
  it('rescales every page of a mixed-size document to a uniform target', async () => {
    const out = await normalizePageSize(await mixedSizePdf(), 'a4');
    const doc = await loadPdf(out);
    const portraitA4 = { w: 595.28, h: 841.89 };
    const landscapeA4 = { w: 841.89, h: 595.28 };
    for (let i = 0; i < doc.getPageCount(); i++) {
      const { width, height } = doc.getPage(i).getSize();
      const match =
        (Math.abs(width - portraitA4.w) < 1 && Math.abs(height - portraitA4.h) < 1) ||
        (Math.abs(width - landscapeA4.w) < 1 && Math.abs(height - landscapeA4.h) < 1);
      expect(match).toBe(true);
    }
  });
});

describe('metadata (title only)', () => {
  it('round-trips a title through save/load', async () => {
    const out = await setTitle(await textPdf(), 'Quarterly Report');
    expect(await getTitle(out)).toBe('Quarterly Report');
  });
});

describe('addSearchableTextLayer (invisible OCR text)', () => {
  it('makes OCR words selectable/extractable without changing page count', async () => {
    const src = await textPdf();
    // Simulate OCR output: place a searchable word on page 1.
    const fakeResults: OcrPageResult[] = [
      {
        pageIndex: 0,
        text: 'SEARCHABLETOKEN',
        words: [
          {
            text: 'SEARCHABLETOKEN',
            confidence: 95,
            bbox: { x: 100, y: 100, width: 200, height: 20 },
          },
        ],
      },
    ];
    const out = await addSearchableTextLayer(src, fakeResults);
    expect(await getPageCount(out)).toBe(await getPageCount(src));
    const text = await extractPlainText(out);
    expect(text).toContain('SEARCHABLETOKEN');
  });
});

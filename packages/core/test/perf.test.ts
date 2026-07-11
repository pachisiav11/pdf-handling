import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { reorderPages } from '../src/pages';
import { rotatePages } from '../src/rotate';
import { deletePages } from '../src/pages';

/** Build-guide perf budget: ops on a ≤50-page doc complete in under 1s. */
describe('performance sanity (500-page document, Phase 6)', () => {
  it('loads, rotates and re-saves a 500-page doc without pathological slowdown', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 500; n++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Page ${n}`, { x: 50, y: 720, size: 18, font });
    }
    const bytes = await doc.save();

    const t0 = performance.now();
    const rotated = await rotatePages(bytes, 90);
    const rotateMs = performance.now() - t0;

    const t1 = performance.now();
    const trimmed = await deletePages(rotated, [0, 1, 2, 3, 4]);
    const deleteMs = performance.now() - t1;

    console.info(`500-page timings: rotate=${rotateMs.toFixed(0)}ms delete=${deleteMs.toFixed(0)}ms`);
    expect(trimmed.length).toBeGreaterThan(0);
    // Generous ceiling — this is a "no UI freeze / no quadratic blowup" check.
    expect(rotateMs).toBeLessThan(5000);
    expect(deleteMs).toBeLessThan(5000);
  }, 60000);
});

describe('performance budget (50-page document)', () => {
  async function make50(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 50; n++) {
      const page = doc.addPage([612, 792]);
      page.drawText(`Page ${n}`, { x: 50, y: 720, size: 18, font });
      for (let l = 0; l < 30; l++) {
        page.drawText(`Line ${l} of body text content for page ${n}.`, {
          x: 50,
          y: 680 - l * 18,
          size: 10,
          font,
        });
      }
    }
    return doc.save();
  }

  it('rotate + delete + reorder each complete under 1s', async () => {
    const bytes = await make50();

    let t0 = performance.now();
    const rotated = await rotatePages(bytes, 90);
    const rotateMs = performance.now() - t0;

    t0 = performance.now();
    const deleted = await deletePages(rotated, [0, 1, 2]);
    const deleteMs = performance.now() - t0;

    const order = Array.from({ length: 47 }, (_, i) => 46 - i);
    t0 = performance.now();
    const reordered = await reorderPages(deleted, order);
    const reorderMs = performance.now() - t0;

    console.info(
      `50-page timings: rotate=${rotateMs.toFixed(0)}ms delete=${deleteMs.toFixed(0)}ms reorder=${reorderMs.toFixed(0)}ms`,
    );
    expect(reordered.length).toBeGreaterThan(0);
    expect(rotateMs).toBeLessThan(1000);
    expect(deleteMs).toBeLessThan(1000);
    expect(reorderMs).toBeLessThan(1000);
  }, 20000);
});

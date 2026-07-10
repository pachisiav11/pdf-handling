import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { reorderPages } from '../src/pages';
import { rotatePages } from '../src/rotate';
import { deletePages } from '../src/pages';

/** Build-guide perf budget: ops on a ≤50-page doc complete in under 1s. */
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

import { describe, expect, it } from 'vitest';
import { addTextItems } from '../src/editing/text';
import { addMarkups } from '../src/editing/highlight';
import { addStrokes } from '../src/editing/draw';
import { addStamps } from '../src/editing/stamp';
import { addPageNumbers } from '../src/editing/pageNumbers';
import { addWatermark } from '../src/editing/watermark';
import { cropPages } from '../src/editing/crop';
import { loadPdf } from '../src/load';
import { extractText } from '../src/view';
import { textPdf } from './fixtures';

async function makePng(w = 60, h = 40): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cc2244';
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(canvas.toBuffer('image/png'));
}

describe('addTextItems', () => {
  it('commits text that survives save and extraction', async () => {
    const out = await addTextItems(await textPdf(), [
      { pageIndex: 0, x: 60, y: 500, text: 'INSERTED-OVERLAY-TEXT', size: 14 },
    ]);
    const text = await extractText(out);
    expect(text[0]).toContain('INSERTED-OVERLAY-TEXT');
    expect(text[0]).toContain('FIXTURE-PAGE-1'); // original content intact
  });
});

describe('addMarkups', () => {
  it('adds highlight rects without destroying text', async () => {
    const out = await addMarkups(await textPdf(), [
      { pageIndex: 0, kind: 'highlight', rects: [{ x: 50, y: 715, width: 200, height: 26 }] },
      { pageIndex: 0, kind: 'underline', rects: [{ x: 50, y: 676, width: 260, height: 14 }] },
    ]);
    const text = await extractText(out);
    expect(text[0]).toContain('FIXTURE-PAGE-1');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('addStrokes', () => {
  it('adds a freehand path', async () => {
    const out = await addStrokes(await textPdf(), [
      {
        pageIndex: 0,
        width: 2,
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 150 },
          { x: 300, y: 90 },
        ],
      },
    ]);
    const doc = await loadPdf(out);
    expect(doc.getPageCount()).toBe(5);
  });
});

describe('addStamps', () => {
  it('embeds and places an image', async () => {
    const png = await makePng();
    const out = await addStamps(await textPdf(), [
      { pageIndex: 1, imageBytes: png, imageType: 'png', rect: { x: 400, y: 60, width: 120, height: 80 } },
    ]);
    expect(out.length).toBeGreaterThan((await textPdf()).length); // image embedded
  });
});

describe('addPageNumbers', () => {
  it('stamps formatted numbers on every page', async () => {
    const out = await addPageNumbers(await textPdf(), {
      position: 'bottom-center',
      format: 'Page {n} of {total}',
    });
    const text = await extractText(out);
    expect(text[0]).toContain('Page 1 of 5');
    expect(text[4]).toContain('Page 5 of 5');
  });
});

describe('addWatermark', () => {
  it('applies a diagonal text watermark to all pages', async () => {
    const out = await addWatermark(await textPdf(), { text: 'CONFIDENTIAL', opacity: 0.2 });
    const text = await extractText(out);
    for (const page of text) expect(page).toContain('CONFIDENTIAL');
  });
});

describe('cropPages', () => {
  it('sets the crop box on selected pages', async () => {
    const out = await cropPages(await textPdf(), { x: 50, y: 50, width: 300, height: 400 }, [0]);
    const doc = await loadPdf(out);
    const cropped = doc.getPage(0).getCropBox();
    expect(cropped).toMatchObject({ x: 50, y: 50, width: 300, height: 400 });
    const untouched = doc.getPage(1).getCropBox();
    expect(untouched.width).toBe(612);
  });
});

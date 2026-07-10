import { describe, expect, it } from 'vitest';
import { extractText, openForRender, renderPageToCanvas } from '../src/view';
import { textPdf } from './fixtures';

describe('extractText', () => {
  it('returns per-page text in order', async () => {
    const pages = await extractText(await textPdf());
    expect(pages).toHaveLength(5);
    expect(pages[0]).toContain('FIXTURE-PAGE-1');
    expect(pages[4]).toContain('FIXTURE-PAGE-5');
  });
});

describe('renderPageToCanvas', () => {
  it('renders a page to a canvas at the requested scale', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const doc = await openForRender(await textPdf());
    try {
      const canvas = createCanvas(1, 1);
      const { width, height } = await renderPageToCanvas(doc, 0, 1.5, canvas);
      expect(width).toBe(Math.ceil(612 * 1.5));
      expect(height).toBe(Math.ceil(792 * 1.5));
      // Rendered content should not be a blank canvas: some pixel must be non-white.
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, width, height).data;
      let nonWhite = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 250) nonWhite++;
      }
      expect(nonWhite).toBeGreaterThan(100);
    } finally {
      await doc.destroy();
    }
  });
});

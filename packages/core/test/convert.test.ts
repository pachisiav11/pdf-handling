import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { imagesToPdf } from '../src/convert/imageToPdf';
import { createNodeCanvasEncoder, pdfToImages } from '../src/convert/pdfToImage';
import { extractPlainText } from '../src/convert/textExtract';
import { ocrPdf } from '../src/convert/ocr';
import { getPageCount, loadPdf } from '../src/load';
import { scannedPdf, textPdf } from './fixtures';

async function makeImages(): Promise<Array<{ bytes: Uint8Array; type: 'png' | 'jpg' }>> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const mk = (w: number, h: number, color: string, format: 'png' | 'jpg') => {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return {
      bytes: new Uint8Array(format === 'png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg', 90)),
      type: format,
    };
  };
  return [mk(800, 600, '#3355aa', 'png'), mk(400, 900, '#aa3355', 'jpg')];
}

describe('imagesToPdf', () => {
  it('creates one page per image sized to the image', async () => {
    const out = await imagesToPdf(await makeImages(), 'fit');
    const doc = await loadPdf(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(800);
    expect(doc.getPage(1).getHeight()).toBe(900);
  });

  it('centers on A4 when requested', async () => {
    const out = await imagesToPdf(await makeImages(), 'a4');
    const doc = await loadPdf(out);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
  });
});

describe('pdfToImages', () => {
  it('renders pages to PNG at the requested scale', async () => {
    const encoder = await createNodeCanvasEncoder();
    const images = await pdfToImages(await textPdf(), { scale: 1, format: 'png', pageIndices: [0, 2] }, encoder);
    expect(images).toHaveLength(2);
    expect(images[0]!.pageIndex).toBe(0);
    expect(images[1]!.pageIndex).toBe(2);
    // PNG magic bytes
    expect(Array.from(images[0]!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(images[0]!.bytes.length).toBeGreaterThan(1000);
  });
});

describe('extractPlainText', () => {
  it('produces labeled per-page plain text', async () => {
    const text = await extractPlainText(await textPdf());
    expect(text).toContain('--- Page 1 ---');
    expect(text).toContain('FIXTURE-PAGE-3');
  });
});

describe('ocrPdf (acceptance: scanned page → roughly correct text)', () => {
  it('reads text out of an image-only PDF', async () => {
    const encoder = await createNodeCanvasEncoder();
    const langPath = join(__dirname, '..', '..', '..', 'apps', 'desktop', 'resources', 'tesseract');
    const results = await ocrPdf(await scannedPdf(), { lang: 'eng', langPath }, encoder);
    expect(results).toHaveLength(1);
    const text = results[0]!.text.toLowerCase();
    expect(text).toContain('quick brown fox');
    expect(text).toContain('lazy dog');
    expect(results[0]!.text).toContain('12345');
    expect(results[0]!.words.length).toBeGreaterThan(5);
    // sanity: the source really had no text layer
    expect(await getPageCount(await scannedPdf())).toBe(1);
  }, 120000);
});

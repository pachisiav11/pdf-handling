import { describe, expect, it } from 'vitest';
import { compressPdf, jpegDimensions } from '../src/compress';
import { createNodeReencoder } from '../src/reencode-node';
import { getPageCount } from '../src/load';
import { imagePdf, textPdf } from './fixtures';

describe('compressPdf', () => {
  it('low preset re-saves losslessly without touching images', async () => {
    const src = await textPdf();
    const out = await compressPdf(src, 'low');
    expect(await getPageCount(out)).toBe(5);
  });

  it('high preset shrinks an image-heavy PDF substantially', async () => {
    const src = await imagePdf();
    const out = await compressPdf(src, 'high', createNodeReencoder());
    expect(await getPageCount(out)).toBe(1);
    expect(out.length).toBeLessThan(src.length * 0.7);
  });

  it('medium sits between low and high on an image-heavy PDF', async () => {
    const src = await imagePdf();
    const reencoder = createNodeReencoder();
    const low = await compressPdf(src, 'low', reencoder);
    const medium = await compressPdf(src, 'medium', reencoder);
    const high = await compressPdf(src, 'high', reencoder);
    expect(medium.length).toBeLessThan(low.length);
    expect(high.length).toBeLessThan(medium.length);
  });
});

describe('jpegDimensions', () => {
  it('reads dimensions from an SOF marker', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(320, 200);
    canvas.getContext('2d').fillRect(0, 0, 320, 200);
    const jpeg = new Uint8Array(canvas.toBuffer('image/jpeg', 80));
    expect(jpegDimensions(jpeg)).toEqual({ width: 320, height: 200 });
  });
});

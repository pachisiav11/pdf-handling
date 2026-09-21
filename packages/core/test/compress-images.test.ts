import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';
import { compressPdf, decodeFlateImage, type FlateImageSource } from '../src/compress';
import { createNodeReencoder } from '../src/reencode-node';
import { createNodeCanvasEncoder, pdfToImages } from '../src/convert/pdfToImage';

const reencoder = createNodeReencoder();

/** Photo-like pixels: smooth gradients plus per-pixel noise (seeded, deterministic). */
function noisyPng(width: number, height: number, alpha = false): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(width, height);
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 48) - 24;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      data.data[o] = (x / width) * 200 + 30 + rand();
      data.data[o + 1] = (y / height) * 180 + 40 + rand();
      data.data[o + 2] = ((x + y) / (width + height)) * 220 + rand();
      data.data[o + 3] = alpha ? 60 + ((x + y) % 190) : 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toBuffer('image/png');
}

function flatPng(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1060c0';
  ctx.fillRect(40, 40, width / 2, height / 3);
  return canvas.toBuffer('image/png');
}

async function pdfWithPng(png: Buffer): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, 459]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 459 });
  return doc.save();
}

/** Every image XObject in the file, with its filter and colour space. */
async function images(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: Array<{ ref: PDFRef; filter: string; colorSpace: string; smask?: PDFRef }> = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const smask = obj.dict.get(PDFName.of('SMask'));
    out.push({
      ref,
      filter: String(obj.dict.get(PDFName.of('Filter'))),
      colorSpace: String(obj.dict.get(PDFName.of('ColorSpace'))),
      smask: smask instanceof PDFRef ? smask : undefined,
    });
  }
  return out;
}

async function renders(bytes: Uint8Array): Promise<boolean> {
  const [page] = await pdfToImages(bytes, { scale: 0.5, format: 'png' }, await createNodeCanvasEncoder());
  return !!page && page.bytes.length > 0;
}

describe('compressPdf — Flate (PNG-type) images', () => {
  it('re-encodes a photographic PNG image as a smaller RGB JPEG', async () => {
    const src = await pdfWithPng(noisyPng(1600, 1200));
    expect((await images(src))[0]!.filter).toBe('/FlateDecode');

    const out = await compressPdf(src, 'medium', reencoder);
    const [img] = await images(out);
    expect(img!.filter).toBe('/DCTDecode');
    expect(img!.colorSpace).toBe('/DeviceRGB');
    expect(out.length).toBeLessThan(src.length * 0.5);
    expect(await renders(out)).toBe(true);
  });

  it('keeps flat graphics lossless', async () => {
    const src = await pdfWithPng(flatPng(1200, 900));
    const out = await compressPdf(src, 'high', reencoder);
    expect((await images(out))[0]!.filter).toBe('/FlateDecode');
  });

  it('keeps transparency: the base image becomes JPEG, its soft mask stays lossless', async () => {
    const src = await pdfWithPng(noisyPng(900, 700, true));
    const out = await compressPdf(src, 'medium', reencoder);
    const all = await images(out);
    const base = all.find((i) => i.smask);
    expect(base?.filter).toBe('/DCTDecode');
    const mask = all.find((i) => base?.smask && i.ref === base.smask);
    expect(mask?.filter).toBe('/FlateDecode');
    expect(await renders(out)).toBe(true);
  });

  it('never touches images with the low preset', async () => {
    const src = await pdfWithPng(noisyPng(800, 600));
    const out = await compressPdf(src, 'low', reencoder);
    expect((await images(out))[0]!.filter).toBe('/FlateDecode');
  });
});

describe('compressPdf — JPEG colour spaces', () => {
  it('relabels a re-encoded grayscale JPEG as RGB (encoders always emit RGB)', async () => {
    const canvas = createCanvas(1600, 1200);
    const ctx = canvas.getContext('2d');
    for (let x = 0; x < 1600; x += 2) {
      ctx.fillStyle = `rgb(${x % 256},${x % 256},${x % 256})`;
      ctx.fillRect(x, 0, 2, 1200);
    }
    const created = await PDFDocument.create();
    const img = await created.embedJpg(canvas.toBuffer('image/jpeg', 98));
    created.addPage([612, 459]).drawImage(img, { x: 0, y: 0, width: 612, height: 459 });
    // Embedded images only exist after a save. Then label it gray, as a scanner would.
    const doc = await PDFDocument.load(await created.save());
    const [, stream] = [...doc.context.enumerateIndirectObjects()].find(
      ([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    )! as [PDFRef, PDFRawStream];
    stream.dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));

    const out = await compressPdf(await doc.save(), 'high', reencoder);
    const [after] = await images(out);
    expect(after!.filter).toBe('/DCTDecode');
    expect(after!.colorSpace).toBe('/DeviceRGB');
  });
});

describe('compressPdf — lossless stream deflate', () => {
  it('deflates an unfiltered stream even with the low preset', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const text = new TextEncoder().encode('BT /F1 12 Tf 10 10 Td (hello) Tj ET\n'.repeat(400));
    const ref = doc.context.register(doc.context.stream(text));
    const src = await doc.save({ useObjectStreams: false });

    const out = await compressPdf(src, 'low');
    const loaded = await PDFDocument.load(out);
    const stream = loaded.context.lookup(ref) as PDFRawStream;
    expect(String(stream.dict.get(PDFName.of('Filter')))).toBe('/FlateDecode');
    expect(new TextDecoder().decode(unzlibSync(stream.getContents()))).toBe(new TextDecoder().decode(text));
    expect(out.length).toBeLessThan(src.length);
  });
});

/** Encode rows with the given PNG filter types, as a PDF writer would. */
function pngFilter(samples: Uint8Array, width: number, colors: number, types: number[]): Uint8Array {
  const rowBytes = width * colors;
  const height = samples.length / rowBytes;
  const out = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const type = types[y % types.length]!;
    out[y * (rowBytes + 1)] = type;
    for (let x = 0; x < rowBytes; x++) {
      const cur = samples[y * rowBytes + x]!;
      const a = x >= colors ? samples[y * rowBytes + x - colors]! : 0;
      const b = y > 0 ? samples[(y - 1) * rowBytes + x]! : 0;
      const c = x >= colors && y > 0 ? samples[(y - 1) * rowBytes + x - colors]! : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * (rowBytes + 1) + 1 + x] = (cur - pred) & 0xff;
    }
  }
  return out;
}

describe('decodeFlateImage', () => {
  const width = 7;
  const height = 10;

  it('undoes every PNG row filter for RGB data', () => {
    const samples = new Uint8Array(width * height * 3).map((_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
    const src: FlateImageSource = {
      kind: 'flate',
      bytes: zlibSync(pngFilter(samples, width, 3, [0, 1, 2, 3, 4])),
      width,
      height,
      colors: 3,
      predictor: 15,
    };
    const { rgba } = decodeFlateImage(src);
    for (let i = 0; i < width * height; i++) {
      expect([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]]).toEqual([
        samples[i * 3],
        samples[i * 3 + 1],
        samples[i * 3 + 2],
        255,
      ]);
    }
  });

  it('expands an indexed palette', () => {
    const lookup = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const indices = new Uint8Array(width * height).map((_, i) => i % 3);
    const { rgba } = decodeFlateImage({
      kind: 'flate',
      bytes: zlibSync(indices),
      width,
      height,
      colors: 1,
      predictor: 1,
      palette: { colors: 3, lookup },
    });
    expect(Array.from(rgba.slice(0, 12))).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });

  it('expands grayscale', () => {
    const gray = new Uint8Array(width * height).map((_, i) => i * 3);
    const { rgba } = decodeFlateImage({
      kind: 'flate',
      bytes: zlibSync(gray),
      width,
      height,
      colors: 1,
      predictor: 1,
    });
    expect(Array.from(rgba.slice(4, 8))).toEqual([3, 3, 3, 255]);
  });

  it('rejects truncated data', () => {
    expect(() =>
      decodeFlateImage({ kind: 'flate', bytes: zlibSync(new Uint8Array(5)), width, height, colors: 3, predictor: 1 }),
    ).toThrow();
  });
});


import { PDFDict, PDFName, PDFRawStream, PDFRef } from 'pdf-lib';
import { loadPdf } from './load';

export type CompressPreset = 'low' | 'medium' | 'high';

/**
 * Re-encodes a JPEG to smaller bytes. Platform-provided (canvas in browsers,
 * @napi-rs/canvas in Node/Electron main). Return null to skip an image
 * (e.g. decode failure) — compression then leaves that image untouched.
 */
export type ImageReencoder = (
  jpegBytes: Uint8Array,
  opts: { maxDimension: number; quality: number },
) => Promise<Uint8Array | null>;

/** Per-preset image handling: Low never touches images (free re-save only). */
const PRESET_IMAGE_OPTS: Record<CompressPreset, { maxDimension: number; quality: number } | null> =
  {
    low: null,
    medium: { maxDimension: 1600, quality: 0.8 },
    high: { maxDimension: 1000, quality: 0.6 },
  };

function isJpegImageStream(dict: PDFDict): boolean {
  const subtype = dict.get(PDFName.of('Subtype'));
  if (subtype !== PDFName.of('Image')) return false;
  const filter = dict.get(PDFName.of('Filter'));
  return filter === PDFName.of('DCTDecode');
}

/**
 * Compress a PDF. All presets re-save with object streams (lossless);
 * medium/high additionally downscale/re-encode embedded JPEGs when a
 * `reencoder` is supplied. Never returns bytes larger than a plain re-save.
 */
export async function compressPdf(
  bytes: Uint8Array,
  preset: CompressPreset,
  reencoder?: ImageReencoder,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const imageOpts = PRESET_IMAGE_OPTS[preset];

  if (imageOpts && reencoder) {
    const replacements: Array<[PDFRef, PDFRawStream]> = [];
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || !isJpegImageStream(obj.dict)) continue;
      const original = obj.getContents();
      const reencoded = await reencoder(original, imageOpts);
      if (!reencoded || reencoded.length >= original.length) continue; // only keep wins
      const dims = jpegDimensions(reencoded);
      const dict = new Map(obj.dict.entries());
      dict.set(PDFName.of('Length'), doc.context.obj(reencoded.length));
      if (dims) {
        dict.set(PDFName.of('Width'), doc.context.obj(dims.width));
        dict.set(PDFName.of('Height'), doc.context.obj(dims.height));
      }
      const newDict = doc.context.obj({});
      for (const [k, v] of dict) newDict.set(k, v);
      replacements.push([ref, PDFRawStream.of(newDict, reencoded)]);
    }
    for (const [ref, stream] of replacements) doc.context.assign(ref, stream);
  }

  return doc.save({ useObjectStreams: true });
}

/** Read width/height from a JPEG's SOF marker (no full decode). */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2; // skip SOI
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    // SOF0..SOF15 excluding DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!,
      };
    }
    i += 2 + ((bytes[i + 2]! << 8) | bytes[i + 3]!);
  }
  return null;
}

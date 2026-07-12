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

/** Image re-encode settings for one compression pass. */
export interface ImageCompressOpts {
  maxDimension: number;
  quality: number;
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
  return compressWithImageOpts(bytes, PRESET_IMAGE_OPTS[preset], reencoder);
}

/**
 * Lower-level compressor shared by presets and target-size mode: re-encodes
 * embedded JPEGs with the given `imageOpts` (null = lossless re-save only) and
 * saves with object streams. Used by {@link compressToTargetSize}'s search.
 */
export async function compressWithImageOpts(
  bytes: Uint8Array,
  imageOpts: ImageCompressOpts | null,
  reencoder?: ImageReencoder,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);

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

/** Map the 0..1 quality knob to concrete image settings (low knob = smaller). */
export function qualityKnobToImageOpts(knob: number): ImageCompressOpts {
  const q = Math.max(0, Math.min(1, knob));
  return {
    maxDimension: Math.round(600 + q * (2200 - 600)), // 600px (max squeeze) → 2200px
    quality: 0.3 + q * (0.92 - 0.3), // JPEG q 0.30 → 0.92
  };
}

export type TargetSizeResult =
  | { ok: true; bytes: Uint8Array; size: number; knob: number }
  | { ok: false; smallestSize: number; smallestBytes: Uint8Array; message: string };

/**
 * Target-size compression via binary search over a single quality knob
 * (build guide "Compression algorithm" v1.1). Finds the highest quality whose
 * output still fits under `targetBytes`, capped at `maxIterations` passes. If
 * even maximum compression can't reach the target, returns `ok:false` with the
 * smallest achievable size and a plain message rather than an oversized file.
 *
 * Needs a `reencoder` to actually shrink image bytes; without one it can only
 * do a single lossless re-save and will report if that alone can't hit target.
 */
export async function compressToTargetSize(
  bytes: Uint8Array,
  targetBytes: number,
  reencoder?: ImageReencoder,
  maxIterations = 6,
): Promise<TargetSizeResult> {
  const fmt = (n: number) => `${(n / (1024 * 1024)).toFixed(1)}MB`;

  // Max-compression pass first: if the smallest we can produce still exceeds the
  // target, there's no point searching — report the floor.
  const smallest = await compressWithImageOpts(bytes, qualityKnobToImageOpts(0), reencoder);
  if (smallest.length > targetBytes) {
    return {
      ok: false,
      smallestSize: smallest.length,
      smallestBytes: smallest,
      message: `Can't reach ${fmt(targetBytes)} — smallest possible is ${fmt(smallest.length)}.`,
    };
  }

  // The floor already fits; binary-search upward for the highest knob that stays
  // under target (closest to the requested size without going over).
  let lo = 0;
  let hi = 1;
  let best = { bytes: smallest, size: smallest.length, knob: 0 };
  const iters = Math.max(1, maxIterations - 1); // one pass already spent on the floor
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    const out = await compressWithImageOpts(bytes, qualityKnobToImageOpts(mid), reencoder);
    if (out.length <= targetBytes) {
      best = { bytes: out, size: out.length, knob: mid };
      lo = mid; // room to raise quality
    } else {
      hi = mid; // too big, lower quality
    }
  }
  return { ok: true, bytes: best.bytes, size: best.size, knob: best.knob };
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

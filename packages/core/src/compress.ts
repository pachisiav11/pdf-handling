import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { inflateSync, unzlibSync, zlibSync } from 'fflate';
import { loadPdf } from './load';

export type CompressPreset = 'low' | 'medium' | 'high';

/** Image re-encode settings for one compression pass. */
export interface ImageCompressOpts {
  maxDimension: number;
  quality: number;
}

/**
 * A Flate-compressed (PNG-style) image as stored in the PDF. Platforms either
 * decode it with {@link decodeFlateImage} or natively (Android).
 */
export interface FlateImageSource {
  kind: 'flate';
  /** Zlib-compressed sample data exactly as stored in the stream. */
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Samples per pixel in the stored data: 1 (gray, or a palette index) or 3 (RGB). */
  colors: 1 | 3;
  /** PDF /Predictor: 1 = none, 10–15 = PNG row filters. */
  predictor: number;
  /** Present for /Indexed images: gray or RGB entries addressed by the index. */
  palette?: { colors: 1 | 3; lookup: Uint8Array };
}

export type ReencodeSource = { kind: 'jpeg'; bytes: Uint8Array } | FlateImageSource;

/**
 * Re-encodes one image to a (usually smaller) baseline RGB JPEG. Platform-
 * provided: OffscreenCanvas in the desktop worker, @napi-rs/canvas in Node,
 * a native module on Android. Return null to leave that image untouched.
 */
export type ImageReencoder = (
  source: ReencodeSource,
  opts: ImageCompressOpts,
) => Promise<Uint8Array | null>;

/** Per-preset image handling: Low never touches images (lossless only). */
const PRESET_IMAGE_OPTS: Record<CompressPreset, ImageCompressOpts | null> = {
  low: null,
  medium: { maxDimension: 1600, quality: 0.8 },
  high: { maxDimension: 1000, quality: 0.6 },
};

/** Images below this many pixels (e.g. icons) aren't worth the JPEG artifacts. */
const MIN_PIXELS = 128 * 128;
/**
 * Flate images already stored below this fraction of their raw size are flat
 * graphics (logos, UI screenshots, diagrams). JPEG blurs their edges for little
 * gain, so they stay lossless.
 */
const FLAT_GRAPHIC_RATIO = 0.1;
/** Unfiltered streams smaller than this aren't worth deflating. */
const MIN_DEFLATE_BYTES = 256;

const name = (n: string) => PDFName.of(n);

function resolve(context: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  return value instanceof PDFRef ? context.lookup(value) : value;
}

function num(context: PDFContext, value: PDFObject | undefined): number | undefined {
  const v = resolve(context, value);
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

/** The single filter a stream uses, 'none', or null for a filter chain. */
function singleFilter(context: PDFContext, dict: PDFDict): string | null {
  const filter = resolve(context, dict.get(name('Filter')));
  if (filter === undefined) return 'none';
  if (filter instanceof PDFName) return filter.decodeText();
  if (filter instanceof PDFArray) {
    if (filter.size() === 0) return 'none';
    const only = resolve(context, filter.get(0));
    return filter.size() === 1 && only instanceof PDFName ? only.decodeText() : null;
  }
  return null;
}

/** Components of a device or ICCBased space, or (with `allowIndexed`) an Indexed one. */
function colorInfo(
  context: PDFContext,
  space: PDFObject | undefined,
  allowIndexed: boolean,
): { colors: number; palette?: FlateImageSource['palette'] } | null {
  const cs = resolve(context, space);
  if (cs instanceof PDFName) {
    const n = cs.decodeText();
    if (n === 'DeviceGray') return { colors: 1 };
    if (n === 'DeviceRGB') return { colors: 3 };
    if (n === 'DeviceCMYK') return { colors: 4 };
    return null;
  }
  if (!(cs instanceof PDFArray) || cs.size() === 0) return null;
  const family = resolve(context, cs.get(0));
  if (!(family instanceof PDFName)) return null;
  if (family.decodeText() === 'ICCBased') {
    const profile = resolve(context, cs.get(1));
    const n = profile instanceof PDFRawStream ? num(context, profile.dict.get(name('N'))) : undefined;
    return n === 1 || n === 3 || n === 4 ? { colors: n } : null;
  }
  if (family.decodeText() === 'Indexed' && allowIndexed && cs.size() === 4) {
    const base = colorInfo(context, cs.get(1), false);
    const hival = num(context, cs.get(2));
    if (!base || (base.colors !== 1 && base.colors !== 3) || hival === undefined) return null;
    const table = resolve(context, cs.get(3));
    let lookup: Uint8Array | null = null;
    if (table instanceof PDFString || table instanceof PDFHexString) lookup = table.asBytes();
    else if (table instanceof PDFRawStream) lookup = decodePDFRawStream(table).decode();
    if (!lookup || lookup.length < (hival + 1) * base.colors) return null;
    return { colors: 1, palette: { colors: base.colors, lookup } };
  }
  return null;
}

function isImage(context: PDFContext, dict: PDFDict): boolean {
  return resolve(context, dict.get(name('Subtype'))) === name('Image');
}

/**
 * Describe a Flate image the re-encoder can handle, or null. Skips anything
 * where lossy JPEG would change meaning: stencil masks, colour-key masks,
 * /Decode remaps, non-8-bit samples, CMYK, and flat graphics.
 */
function flateSource(
  context: PDFContext,
  dict: PDFDict,
  contents: Uint8Array,
): FlateImageSource | null {
  if (singleFilter(context, dict) !== 'FlateDecode') return null;
  const imageMask = resolve(context, dict.get(name('ImageMask')));
  if (imageMask instanceof PDFBool && imageMask.asBoolean()) return null;
  if (resolve(context, dict.get(name('Mask'))) instanceof PDFArray) return null;
  if (dict.get(name('Decode')) !== undefined) return null;
  if (num(context, dict.get(name('BitsPerComponent'))) !== 8) return null;

  const width = num(context, dict.get(name('Width')));
  const height = num(context, dict.get(name('Height')));
  if (!width || !height || width * height < MIN_PIXELS) return null;

  const color = colorInfo(context, dict.get(name('ColorSpace')), true);
  if (!color || (color.colors !== 1 && color.colors !== 3)) return null;
  const colors = color.colors;

  let parms = resolve(context, dict.get(name('DecodeParms')));
  if (parms instanceof PDFArray) parms = resolve(context, parms.get(0));
  let predictor = 1;
  if (parms instanceof PDFDict) {
    predictor = num(context, parms.get(name('Predictor'))) ?? 1;
    if (predictor >= 10) {
      const pColors = num(context, parms.get(name('Colors'))) ?? 1;
      const pBits = num(context, parms.get(name('BitsPerComponent'))) ?? 8;
      const pColumns = num(context, parms.get(name('Columns'))) ?? 1;
      if (pColors !== colors || pBits !== 8 || pColumns !== width) return null;
    } else if (predictor !== 1) {
      return null; // TIFF predictor: rare, not supported
    }
  }

  if (contents.length < FLAT_GRAPHIC_RATIO * width * height * colors) return null;
  return { kind: 'flate', bytes: contents, width, height, colors, predictor, palette: color.palette };
}

function jpegSourceAllowed(context: PDFContext, dict: PDFDict): boolean {
  if (singleFilter(context, dict) !== 'DCTDecode') return false;
  // A /Decode remap (typical of inverted Adobe CMYK) can't survive a round trip
  // through a canvas decoder that applies its own inversion rules.
  if (dict.get(name('Decode')) !== undefined) return false;
  return !!colorInfo(context, dict.get(name('ColorSpace')), false);
}

/** Refs used as another image's /SMask or /Mask: alpha must stay lossless. */
function maskRefs(context: PDFContext): Set<PDFRef> {
  const refs = new Set<PDFRef>();
  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || !isImage(context, obj.dict)) continue;
    for (const key of ['SMask', 'Mask']) {
      const value = obj.dict.get(name(key));
      if (value instanceof PDFRef) refs.add(value);
    }
  }
  return refs;
}

/**
 * Fresh image dict for a re-encoded JPEG. Encoders always emit RGB, so the
 * old /ColorSpace (gray, CMYK, ICC) must not carry over.
 */
function jpegDict(
  context: PDFContext,
  old: PDFDict,
  jpeg: Uint8Array,
  fallback: { width: number; height: number },
): PDFDict {
  const dims = jpegDimensions(jpeg) ?? fallback;
  const dict = context.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: dims.width,
    Height: dims.height,
    ColorSpace: 'DeviceRGB',
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
    Length: jpeg.length,
  });
  for (const key of ['SMask', 'Intent', 'Interpolate', 'Metadata', 'OC', 'StructParent']) {
    const value = old.get(name(key));
    if (value !== undefined) dict.set(name(key), value);
  }
  return dict;
}

/**
 * Compress a PDF. Every preset deflates unfiltered streams and re-saves with
 * object streams (lossless). Medium and high also re-encode photographic
 * images — JPEG and 8-bit gray/RGB/palette Flate images — as smaller JPEGs
 * when a `reencoder` is supplied. An image is only replaced when the result is
 * smaller. Text and vector content are never touched.
 */
export async function compressPdf(
  bytes: Uint8Array,
  preset: CompressPreset,
  reencoder?: ImageReencoder,
): Promise<Uint8Array> {
  return compressWithImageOpts(bytes, PRESET_IMAGE_OPTS[preset], reencoder);
}

/**
 * Lower-level compressor shared by presets and target-size mode. `imageOpts`
 * null means lossless only. Used by {@link compressToTargetSize}'s search.
 */
export async function compressWithImageOpts(
  bytes: Uint8Array,
  imageOpts: ImageCompressOpts | null,
  reencoder?: ImageReencoder,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const context = doc.context;
  const lossy = imageOpts && reencoder ? { opts: imageOpts, reencoder } : null;
  const masks = lossy ? maskRefs(context) : new Set<PDFRef>();
  const replacements: Array<[PDFRef, PDFRawStream]> = [];

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const contents = obj.getContents();

    if (lossy && isImage(context, dict) && !masks.has(ref)) {
      const source: ReencodeSource | null = jpegSourceAllowed(context, dict)
        ? { kind: 'jpeg', bytes: contents }
        : flateSource(context, dict, contents);
      if (source) {
        const jpeg = await lossy.reencoder(source, lossy.opts).catch(() => null);
        if (jpeg && jpeg.length < contents.length) {
          const fallback = {
            width: num(context, dict.get(name('Width'))) ?? 1,
            height: num(context, dict.get(name('Height'))) ?? 1,
          };
          replacements.push([ref, PDFRawStream.of(jpegDict(context, dict, jpeg, fallback), jpeg)]);
          continue;
        }
      }
    }

    // Lossless: deflate streams stored with no filter at all. XMP metadata
    // stays plain because PDF/A requires it to be readable.
    if (
      singleFilter(context, dict) === 'none' &&
      dict.get(name('DecodeParms')) === undefined &&
      resolve(context, dict.get(name('Type'))) !== name('Metadata') &&
      contents.length >= MIN_DEFLATE_BYTES
    ) {
      const deflated = zlibSync(contents, { level: 9 });
      if (deflated.length < contents.length) {
        const next = context.obj({});
        for (const [k, v] of dict.entries()) next.set(k, v);
        next.set(name('Filter'), name('FlateDecode'));
        next.set(name('Length'), context.obj(deflated.length));
        replacements.push([ref, PDFRawStream.of(next, deflated)]);
      }
    }
  }
  for (const [ref, stream] of replacements) context.assign(ref, stream);

  return doc.save({ useObjectStreams: true });
}

/**
 * Decode a {@link FlateImageSource} to RGBA pixels (inflate, undo PNG row
 * filters, expand gray or palette). For platforms with a canvas.
 */
export function decodeFlateImage(src: FlateImageSource): {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
} {
  let raw: Uint8Array;
  try {
    raw = unzlibSync(src.bytes);
  } catch {
    raw = inflateSync(src.bytes); // some writers omit the zlib header
  }
  const { width, height, colors, predictor, palette } = src;
  const rowBytes = width * colors;
  const png = predictor >= 10;
  const stride = png ? rowBytes + 1 : rowBytes;
  if (raw.length < stride * height) throw new Error('Image data is shorter than its dimensions.');

  const samples = png ? new Uint8Array(rowBytes * height) : raw;
  if (png) {
    const prev = new Uint8Array(rowBytes);
    for (let y = 0; y < height; y++) {
      const type = raw[y * stride]!;
      const input = raw.subarray(y * stride + 1, y * stride + 1 + rowBytes);
      const row = samples.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= colors ? row[x - colors]! : 0;
        const b = prev[x]!;
        const c = x >= colors ? prev[x - colors]! : 0;
        let v = input[x]!;
        if (type === 1) v += a;
        else if (type === 2) v += b;
        else if (type === 3) v += (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[x] = v & 0xff;
      }
      prev.set(row);
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    if (palette) {
      const at = samples[i]! * palette.colors;
      const r = palette.lookup[at] ?? 0;
      rgba[o] = r;
      rgba[o + 1] = palette.colors === 3 ? (palette.lookup[at + 1] ?? 0) : r;
      rgba[o + 2] = palette.colors === 3 ? (palette.lookup[at + 2] ?? 0) : r;
    } else if (colors === 3) {
      rgba[o] = samples[i * 3]!;
      rgba[o + 1] = samples[i * 3 + 1]!;
      rgba[o + 2] = samples[i * 3 + 2]!;
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = samples[i]!;
    }
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

/** Target pixel size for re-encoding under `maxDimension`, keeping aspect. */
export function scaledSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
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

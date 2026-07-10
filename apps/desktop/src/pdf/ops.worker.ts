/**
 * Web Worker running every mutating PDF operation, so the UI thread never
 * blocks during multi-page work (build guide: performance requirements).
 */
import {
  compressPdf,
  deletePages,
  extractPages,
  mergePdfs,
  reorderPages,
  rotatePages,
  splitByRange,
  splitToSinglePages,
  type CompressPreset,
  type ImageReencoder,
  type RotationDelta,
} from '@pdfx/core';

export type OpRequest =
  | { id: number; op: 'merge'; sources: Uint8Array[] }
  | { id: number; op: 'splitRange'; bytes: Uint8Array; range: string }
  | { id: number; op: 'splitAll'; bytes: Uint8Array; baseName: string }
  | { id: number; op: 'deletePages'; bytes: Uint8Array; indices: number[] }
  | { id: number; op: 'extractPages'; bytes: Uint8Array; indices: number[] }
  | { id: number; op: 'reorderPages'; bytes: Uint8Array; newOrder: number[] }
  | { id: number; op: 'rotatePages'; bytes: Uint8Array; delta: RotationDelta; indices?: number[] }
  | { id: number; op: 'compress'; bytes: Uint8Array; preset: CompressPreset };

export type OpResponse =
  | { id: number; ok: true; bytes: Uint8Array }
  | { id: number; ok: false; message: string };

/** JPEG re-encoder backed by OffscreenCanvas (available in workers). */
const reencoder: ImageReencoder = async (jpegBytes, { maxDimension, quality }) => {
  try {
    const bitmap = await createImageBitmap(new Blob([jpegBytes.slice()], { type: 'image/jpeg' }));
    const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
};

async function run(req: OpRequest): Promise<Uint8Array> {
  switch (req.op) {
    case 'merge':
      return mergePdfs(req.sources);
    case 'splitRange':
      return splitByRange(req.bytes, req.range);
    case 'splitAll':
      return splitToSinglePages(req.bytes, req.baseName);
    case 'deletePages':
      return deletePages(req.bytes, req.indices);
    case 'extractPages':
      return extractPages(req.bytes, req.indices);
    case 'reorderPages':
      return reorderPages(req.bytes, req.newOrder);
    case 'rotatePages':
      return rotatePages(req.bytes, req.delta, req.indices);
    case 'compress':
      return compressPdf(req.bytes, req.preset, reencoder);
  }
}

self.onmessage = async (e: MessageEvent<OpRequest>) => {
  const req = e.data;
  try {
    const bytes = await run(req);
    const res: OpResponse = { id: req.id, ok: true, bytes };
    (self as unknown as Worker).postMessage(res, [bytes.buffer as ArrayBuffer]);
  } catch (err) {
    const res: OpResponse = {
      id: req.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
};

/**
 * Web Worker running every mutating PDF operation, so the UI thread never
 * blocks during multi-page work (build guide: performance requirements).
 */
import {
  addMarkups,
  createFormFields,
  fillFormFields,
  imagesToPdf,
  listFormFields,
  type ImageInput,
  type ImagePageSize,
  type FieldInfo,
  type FieldValue,
  type NewFieldSpec,
  addPageNumbers,
  addStamps,
  addStrokes,
  addTextItems,
  addWatermark,
  compressPdf,
  compressToTargetSize,
  cropPages,
  deletePages,
  extractPages,
  mergePdfs,
  normalizePageSize,
  reorderPages,
  replacePagesWithImages,
  rotatePages,
  setTitle,
  splitByRange,
  splitToSinglePages,
  addSearchableTextLayer,
  type CompressPreset,
  type ImageReencoder,
  type Markup,
  type OcrPageResult,
  type PageImageReplacement,
  type PageNumberOptions,
  type PaperSize,
  type Rect,
  type RotationDelta,
  type Stamp,
  type Stroke,
  type TargetSizeResult,
  type TextItem,
  type WatermarkOptions,
} from '@pdfx/core';

export type OpRequest =
  | { id: number; op: 'merge'; sources: Uint8Array[] }
  | { id: number; op: 'splitRange'; bytes: Uint8Array; range: string }
  | { id: number; op: 'splitAll'; bytes: Uint8Array; baseName: string }
  | { id: number; op: 'deletePages'; bytes: Uint8Array; indices: number[] }
  | { id: number; op: 'extractPages'; bytes: Uint8Array; indices: number[] }
  | { id: number; op: 'reorderPages'; bytes: Uint8Array; newOrder: number[] }
  | { id: number; op: 'rotatePages'; bytes: Uint8Array; delta: RotationDelta; indices?: number[] }
  | { id: number; op: 'compress'; bytes: Uint8Array; preset: CompressPreset }
  | { id: number; op: 'compressTarget'; bytes: Uint8Array; targetBytes: number }
  | { id: number; op: 'normalize'; bytes: Uint8Array; size: PaperSize }
  | { id: number; op: 'setTitle'; bytes: Uint8Array; title: string }
  | { id: number; op: 'searchableLayer'; bytes: Uint8Array; pages: OcrPageResult[] }
  | { id: number; op: 'addText'; bytes: Uint8Array; items: TextItem[] }
  | { id: number; op: 'addMarkups'; bytes: Uint8Array; markups: Markup[] }
  | { id: number; op: 'addStrokes'; bytes: Uint8Array; strokes: Stroke[] }
  | { id: number; op: 'addStamps'; bytes: Uint8Array; stamps: Stamp[] }
  | { id: number; op: 'pageNumbers'; bytes: Uint8Array; options: PageNumberOptions }
  | { id: number; op: 'watermark'; bytes: Uint8Array; options: WatermarkOptions }
  | { id: number; op: 'crop'; bytes: Uint8Array; box: Rect; indices?: number[] }
  | { id: number; op: 'replacePages'; bytes: Uint8Array; replacements: PageImageReplacement[] }
  | { id: number; op: 'imagesToPdf'; images: ImageInput[]; pageSize: ImagePageSize }
  | { id: number; op: 'listFields'; bytes: Uint8Array }
  | { id: number; op: 'fillFields'; bytes: Uint8Array; values: FieldValue[] }
  | { id: number; op: 'createFields'; bytes: Uint8Array; specs: NewFieldSpec[] };

export type OpResponse =
  | { id: number; ok: true; bytes: Uint8Array }
  | { id: number; ok: true; data: FieldInfo[] | TargetSizeResult }
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

async function run(
  req: OpRequest,
): Promise<Uint8Array | { data: FieldInfo[] | TargetSizeResult }> {
  switch (req.op) {
    case 'listFields':
      return { data: await listFormFields(req.bytes) };
    case 'compressTarget':
      return { data: await compressToTargetSize(req.bytes, req.targetBytes, reencoder) };
    case 'normalize':
      return normalizePageSize(req.bytes, req.size);
    case 'setTitle':
      return setTitle(req.bytes, req.title);
    case 'searchableLayer':
      return addSearchableTextLayer(req.bytes, req.pages);
    case 'fillFields':
      return fillFormFields(req.bytes, req.values);
    case 'createFields':
      return createFormFields(req.bytes, req.specs);
    case 'imagesToPdf':
      return imagesToPdf(req.images, req.pageSize);
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
    case 'addText':
      return addTextItems(req.bytes, req.items);
    case 'addMarkups':
      return addMarkups(req.bytes, req.markups);
    case 'addStrokes':
      return addStrokes(req.bytes, req.strokes);
    case 'addStamps':
      return addStamps(req.bytes, req.stamps);
    case 'pageNumbers':
      return addPageNumbers(req.bytes, req.options);
    case 'watermark':
      return addWatermark(req.bytes, req.options);
    case 'crop':
      return cropPages(req.bytes, req.box, req.indices);
    case 'replacePages':
      return replacePagesWithImages(req.bytes, req.replacements);
  }
}

self.onmessage = async (e: MessageEvent<OpRequest>) => {
  const req = e.data;
  try {
    const result = await run(req);
    if (result instanceof Uint8Array) {
      const res: OpResponse = { id: req.id, ok: true, bytes: result };
      (self as unknown as Worker).postMessage(res, [result.buffer as ArrayBuffer]);
    } else {
      const res: OpResponse = { id: req.id, ok: true, data: result.data };
      (self as unknown as Worker).postMessage(res);
    }
  } catch (err) {
    const res: OpResponse = {
      id: req.id,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
};

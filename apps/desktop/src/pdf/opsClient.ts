import type { OpRequest, OpResponse } from './ops.worker';

/** Promise RPC over the ops worker. One worker instance for the app. */
const worker = new Worker(new URL('./ops.worker.ts', import.meta.url), { type: 'module' });

let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

worker.onmessage = (e: MessageEvent<OpResponse>) => {
  const res = e.data;
  const entry = pending.get(res.id);
  if (!entry) return;
  pending.delete(res.id);
  if (!res.ok) entry.reject(new Error(res.message));
  else if ('bytes' in res) entry.resolve(res.bytes);
  else entry.resolve(res.data);
};

// Omit over a discriminated union must distribute, or only common keys survive.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function callRaw(req: DistributiveOmit<OpRequest, 'id'>): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...req, id });
  });
}

function call(req: DistributiveOmit<OpRequest, 'id'>): Promise<Uint8Array> {
  return callRaw(req) as Promise<Uint8Array>;
}

// Bytes are copied (not transferred) so callers keep their working copy for undo.
export const ops = {
  merge: (sources: Uint8Array[]) => call({ op: 'merge', sources: sources.map((s) => s.slice()) }),
  splitRange: (bytes: Uint8Array, range: string) =>
    call({ op: 'splitRange', bytes: bytes.slice(), range }),
  splitAll: (bytes: Uint8Array, baseName: string) =>
    call({ op: 'splitAll', bytes: bytes.slice(), baseName }),
  deletePages: (bytes: Uint8Array, indices: number[]) =>
    call({ op: 'deletePages', bytes: bytes.slice(), indices }),
  extractPages: (bytes: Uint8Array, indices: number[]) =>
    call({ op: 'extractPages', bytes: bytes.slice(), indices }),
  reorderPages: (bytes: Uint8Array, newOrder: number[]) =>
    call({ op: 'reorderPages', bytes: bytes.slice(), newOrder }),
  rotatePages: (bytes: Uint8Array, delta: 90 | 180 | 270, indices?: number[]) =>
    call({ op: 'rotatePages', bytes: bytes.slice(), delta, indices }),
  compress: (bytes: Uint8Array, preset: 'low' | 'medium' | 'high') =>
    call({ op: 'compress', bytes: bytes.slice(), preset }),
  compressTarget: (bytes: Uint8Array, targetBytes: number) =>
    callRaw({ op: 'compressTarget', bytes: bytes.slice(), targetBytes }) as Promise<
      import('@pdfx/core').TargetSizeResult
    >,
  normalize: (bytes: Uint8Array, size: import('@pdfx/core').PaperSize) =>
    call({ op: 'normalize', bytes: bytes.slice(), size }),
  setTitle: (bytes: Uint8Array, title: string) =>
    call({ op: 'setTitle', bytes: bytes.slice(), title }),
  searchableLayer: (bytes: Uint8Array, pages: import('@pdfx/core').OcrPageResult[]) =>
    call({ op: 'searchableLayer', bytes: bytes.slice(), pages }),
  addText: (bytes: Uint8Array, items: import('@pdfx/core').TextItem[]) =>
    call({ op: 'addText', bytes: bytes.slice(), items }),
  addMarkups: (bytes: Uint8Array, markups: import('@pdfx/core').Markup[]) =>
    call({ op: 'addMarkups', bytes: bytes.slice(), markups }),
  addStrokes: (bytes: Uint8Array, strokes: import('@pdfx/core').Stroke[]) =>
    call({ op: 'addStrokes', bytes: bytes.slice(), strokes }),
  addStamps: (bytes: Uint8Array, stamps: import('@pdfx/core').Stamp[]) =>
    call({ op: 'addStamps', bytes: bytes.slice(), stamps }),
  pageNumbers: (bytes: Uint8Array, options: import('@pdfx/core').PageNumberOptions) =>
    call({ op: 'pageNumbers', bytes: bytes.slice(), options }),
  watermark: (bytes: Uint8Array, options: import('@pdfx/core').WatermarkOptions) =>
    call({ op: 'watermark', bytes: bytes.slice(), options }),
  crop: (bytes: Uint8Array, box: import('@pdfx/core').Rect, indices?: number[]) =>
    call({ op: 'crop', bytes: bytes.slice(), box, indices }),
  replacePages: (bytes: Uint8Array, replacements: import('@pdfx/core').PageImageReplacement[]) =>
    call({ op: 'replacePages', bytes: bytes.slice(), replacements }),
  imagesToPdf: (images: import('@pdfx/core').ImageInput[], pageSize: import('@pdfx/core').ImagePageSize) =>
    call({ op: 'imagesToPdf', images, pageSize }),
  listFields: (bytes: Uint8Array) =>
    callRaw({ op: 'listFields', bytes: bytes.slice() }) as Promise<
      import('@pdfx/core').FieldInfo[]
    >,
  fillFields: (bytes: Uint8Array, values: import('@pdfx/core').FieldValue[]) =>
    call({ op: 'fillFields', bytes: bytes.slice(), values }),
  createFields: (bytes: Uint8Array, specs: import('@pdfx/core').NewFieldSpec[]) =>
    call({ op: 'createFields', bytes: bytes.slice(), specs }),
};

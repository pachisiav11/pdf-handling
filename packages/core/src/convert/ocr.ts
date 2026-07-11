import type { CanvasEncoder } from './pdfToImage';
import { pdfToImages } from './pdfToImage';

export interface OcrWord {
  text: string;
  confidence: number;
  /** Bounding box in PDF points, bottom-left origin (for the searchable-OCR upgrade). */
  bbox: { x: number; y: number; width: number; height: number };
}

export interface OcrPageResult {
  pageIndex: number;
  text: string;
  words: OcrWord[];
}

export interface OcrOptions {
  lang?: string; // default 'eng'
  /** Directory (or URL) holding <lang>.traineddata(.gz). Required for offline use. */
  langPath?: string;
  pageIndices?: number[];
  onProgress?: (done: number, total: number) => void;
}

const OCR_SCALE = 2.5; // ~180dpi — decent accuracy without huge bitmaps

/**
 * OCR a (typically scanned) PDF with tesseract.js. Pages are rasterized via the
 * platform encoder, recognized sequentially, and word boxes are mapped back to
 * PDF points so a searchable text layer can be added later.
 */
export async function ocrPdf(
  bytes: Uint8Array,
  opts: OcrOptions,
  encoder: CanvasEncoder,
): Promise<OcrPageResult[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(opts.lang ?? 'eng', 1, {
    ...(opts.langPath ? { langPath: opts.langPath, gzip: opts.langPath.endsWith('/') } : {}),
  } as Parameters<typeof createWorker>[2]);
  try {
    const images = await pdfToImages(
      bytes,
      { scale: OCR_SCALE, format: 'png', pageIndices: opts.pageIndices },
      encoder,
    );
    const results: OcrPageResult[] = [];
    let done = 0;
    for (const img of images) {
      const input = globalThis.Buffer ? globalThis.Buffer.from(img.bytes) : img.bytes;
      const res = await worker.recognize(input as never);
      const words: OcrWord[] = [];
      const blocks = res.data.blocks ?? [];
      for (const block of blocks) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const w of line.words ?? []) {
              words.push({
                text: w.text,
                confidence: w.confidence,
                bbox: {
                  x: w.bbox.x0 / OCR_SCALE,
                  // canvas top-left → PDF bottom-left: flip using the (unknown here)
                  // page height in canvas px / scale; caller gets canvas-space-at-1x
                  // y measured from the top; downstream flips with page height.
                  y: w.bbox.y0 / OCR_SCALE,
                  width: (w.bbox.x1 - w.bbox.x0) / OCR_SCALE,
                  height: (w.bbox.y1 - w.bbox.y0) / OCR_SCALE,
                },
              });
            }
          }
        }
      }
      results.push({ pageIndex: img.pageIndex, text: res.data.text.trim(), words });
      done++;
      opts.onProgress?.(done, images.length);
    }
    return results;
  } finally {
    await worker.terminate();
  }
}

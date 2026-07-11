import { openForRender, renderPageToCanvas, type RenderTarget } from '../view';

export interface PdfToImageOptions {
  /** Render scale: 1 = 72dpi, 2 = 144dpi, ~4.17 = 300dpi. */
  scale: number;
  format: 'png' | 'jpeg';
  quality?: number; // jpeg only, 0..1
  pageIndices?: number[]; // omit = all pages
}

/** Platform canvas: create a canvas and encode it. Browser uses HTMLCanvas/OffscreenCanvas,
    Node uses @napi-rs/canvas (see createNodeCanvasEncoder). */
export interface CanvasEncoder {
  create(width: number, height: number): RenderTarget;
  encode(canvas: RenderTarget, format: 'png' | 'jpeg', quality?: number): Promise<Uint8Array>;
}

export interface PageImage {
  pageIndex: number;
  bytes: Uint8Array;
}

/** Render PDF pages to images. */
export async function pdfToImages(
  bytes: Uint8Array,
  opts: PdfToImageOptions,
  encoder: CanvasEncoder,
): Promise<PageImage[]> {
  const doc = await openForRender(bytes);
  try {
    const indices = opts.pageIndices ?? Array.from({ length: doc.numPages }, (_, i) => i);
    const out: PageImage[] = [];
    for (const i of indices) {
      const canvas = encoder.create(1, 1);
      await renderPageToCanvas(doc, i, opts.scale, canvas);
      out.push({ pageIndex: i, bytes: await encoder.encode(canvas, opts.format, opts.quality) });
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Node encoder backed by @napi-rs/canvas (lazy dynamic import so browser
    bundles that import @pdfx/core never pull the native module). */
export async function createNodeCanvasEncoder(): Promise<CanvasEncoder> {
  const { createCanvas } = await (await import('../node-canvas')).loadNodeCanvas();
  return {
    create(width, height) {
      return createCanvas(width, height) as unknown as RenderTarget;
    },
    async encode(canvas, format, quality) {
      const c = canvas as unknown as { toBuffer(mime: string, q?: number): Buffer };
      return format === 'png'
        ? new Uint8Array(c.toBuffer('image/png'))
        : new Uint8Array(c.toBuffer('image/jpeg', Math.round((quality ?? 0.9) * 100)));
    },
  };
}

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Configure the pdf.js worker for browser contexts (call once at app startup
 * with the bundled worker URL). In Node/tests, pdf.js falls back to a fake
 * worker automatically and this is unnecessary.
 */
export function configurePdfjsWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

export interface OpenOptions {
  /** Where pdf.js loads the standard-14 font glyph data from. Auto-detected in Node. */
  standardFontDataUrl?: string;
}

async function defaultStandardFontDataUrl(): Promise<string | undefined> {
  // In browsers the bundler/app configures this; in Node resolve from the installed package.
  if (typeof window !== 'undefined') return undefined;
  try {
    const { createRequire } = await import('module');
    const { dirname, join } = await import('path');
    const req = createRequire(import.meta.url);
    const pkgDir = dirname(req.resolve('pdfjs-dist/package.json'));
    return join(pkgDir, 'standard_fonts') + '/';
  } catch {
    return undefined;
  }
}

export async function openForRender(
  bytes: Uint8Array,
  opts: OpenOptions = {},
): Promise<PDFDocumentProxy> {
  const standardFontDataUrl = opts.standardFontDataUrl ?? (await defaultStandardFontDataUrl());
  // pdf.js transfers the buffer to its worker; copy so callers keep their bytes.
  return pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  }).promise;
}

export interface RenderTarget {
  // Matches both HTMLCanvasElement/OffscreenCanvas and node canvas implementations.
  getContext(type: '2d'): unknown;
  width: number;
  height: number;
}

/**
 * Render one page (0-based) into `canvas` at `scale` (1 = 72dpi CSS pixels).
 * Resizes the canvas to fit. Returns the rendered {width, height}.
 */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageIndex: number,
  scale: number,
  canvas: RenderTarget,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({
    canvasContext: ctx as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return { width: canvas.width, height: canvas.height };
}

/** Extract text per page in pdf.js reading order. */
export async function extractText(bytes: Uint8Array): Promise<string[]> {
  const doc = await openForRender(bytes);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/**
 * pdf.js rendering for the renderer process: thumbnails and full pages.
 * pdf.js runs its own dedicated worker (bundled via Vite ?url import).
 */
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Cache of open pdf.js documents keyed by docId; invalidated when bytes change. */
const cache = new Map<string, { version: number; doc: Promise<PDFDocumentProxy> }>();

export function getRenderDoc(
  docId: string,
  version: number,
  bytes: Uint8Array,
): Promise<PDFDocumentProxy> {
  const entry = cache.get(docId);
  if (entry && entry.version === version) return entry.doc;
  if (entry) entry.doc.then((d) => d.destroy()).catch(() => undefined);
  const doc = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  cache.set(docId, { version, doc });
  return doc;
}

export function releaseRenderDoc(docId: string): void {
  const entry = cache.get(docId);
  if (entry) {
    entry.doc.then((d) => d.destroy()).catch(() => undefined);
    cache.delete(docId);
  }
}

/** Renders are serialized per canvas: pdf.js throws if two render() calls
    overlap on one canvas, and React StrictMode double-runs effects, so
    concurrent calls for the same canvas queue behind each other. */
const chains = new WeakMap<HTMLCanvasElement, Promise<void>>();

/** Render a page to a canvas sized for `targetWidth` CSS px at devicePixelRatio. */
export function renderPage(
  doc: PDFDocumentProxy,
  pageIndex: number,
  targetWidth: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const prev = chains.get(canvas) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const scale = (targetWidth / base.width) * dpr;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
    });
  chains.set(canvas, next);
  return next;
}

/** Page aspect ratios (h/w) for layout before thumbnails render. */
export async function pageAspects(doc: PDFDocumentProxy): Promise<number[]> {
  const aspects: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    aspects.push(vp.height / vp.width);
  }
  return aspects;
}

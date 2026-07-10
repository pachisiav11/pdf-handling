import { openForRender, renderPageToCanvas } from '../view';
import type { RedactionRasterizer } from './redact';

/**
 * RedactionRasterizer for Node (Electron main / worker_threads / tests),
 * backed by @napi-rs/canvas. Browser/worker contexts use an OffscreenCanvas
 * implementation in the app instead.
 */
export function createNodeRedactionRasterizer(): RedactionRasterizer {
  return async (bytes, pageIndex, scale, rects) => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const doc = await openForRender(bytes);
    try {
      const page = await doc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      const canvas = createCanvas(Math.ceil(vp.width * scale), Math.ceil(vp.height * scale));
      await renderPageToCanvas(doc, pageIndex, scale, canvas as never);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      for (const r of rects) {
        // PDF bottom-left origin → canvas top-left origin
        ctx.fillRect(
          r.x * scale,
          (vp.height - r.y - r.height) * scale,
          r.width * scale,
          r.height * scale,
        );
      }
      return new Uint8Array(canvas.toBuffer('image/png'));
    } finally {
      await doc.destroy();
    }
  };
}

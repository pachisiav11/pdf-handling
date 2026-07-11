import type { ImageReencoder } from './compress';

/**
 * ImageReencoder backed by @napi-rs/canvas, for Node contexts (Electron main /
 * worker_threads, unit tests). Browser/renderer contexts should use an
 * OffscreenCanvas-based implementation instead. Loaded lazily so importing
 * @pdfx/core in a browser bundle doesn't pull in the native module.
 */
export function createNodeReencoder(): ImageReencoder {
  return async (jpegBytes, { maxDimension, quality }) => {
    try {
      const { createCanvas, loadImage } = await (await import('./node-canvas')).loadNodeCanvas();
      const img = await loadImage(Buffer.from(jpegBytes));
      const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return new Uint8Array(canvas.toBuffer('image/jpeg', Math.round(quality * 100)));
    } catch {
      return null; // decode failure — leave this image untouched
    }
  };
}

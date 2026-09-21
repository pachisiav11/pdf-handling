import type { Canvas, Image } from '@napi-rs/canvas';
import { decodeFlateImage, scaledSize, type ImageReencoder } from './compress';

/**
 * ImageReencoder backed by @napi-rs/canvas, for Node contexts (Electron main /
 * worker_threads, unit tests). Browser/renderer contexts should use an
 * OffscreenCanvas-based implementation instead. Loaded lazily so importing
 * @pdfx/core in a browser bundle doesn't pull in the native module.
 */
export function createNodeReencoder(): ImageReencoder {
  return async (source, { maxDimension, quality }) => {
    try {
      const { createCanvas, loadImage } = await (await import('./node-canvas')).loadNodeCanvas();
      let image: Image | Canvas;
      let width: number;
      let height: number;
      if (source.kind === 'jpeg') {
        const img = await loadImage(Buffer.from(source.bytes));
        image = img;
        width = img.width;
        height = img.height;
      } else {
        const px = decodeFlateImage(source);
        const full = createCanvas(px.width, px.height);
        const ctx = full.getContext('2d');
        const data = ctx.createImageData(px.width, px.height);
        data.data.set(px.rgba);
        ctx.putImageData(data, 0, 0);
        image = full;
        width = px.width;
        height = px.height;
      }
      const size = scaledSize(width, height, maxDimension);
      const canvas = createCanvas(size.width, size.height);
      canvas.getContext('2d').drawImage(image, 0, 0, size.width, size.height);
      return new Uint8Array(canvas.toBuffer('image/jpeg', Math.round(quality * 100)));
    } catch {
      return null; // decode failure — leave this image untouched
    }
  };
}

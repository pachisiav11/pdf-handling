import { degrees, rgb, StandardFonts } from 'pdf-lib';
import { loadPdf } from '../load';
import type { RGB } from './types';

export interface WatermarkOptions {
  text?: string;
  imageBytes?: Uint8Array;
  imageType?: 'png' | 'jpg';
  opacity?: number; // default 0.15
  rotationDegrees?: number; // default 45 (diagonal)
  size?: number; // text size (default scales to page) or image width in pt
  color?: RGB;
}

/** Apply a diagonal text or image watermark to every page. */
export async function addWatermark(bytes: Uint8Array, opts: WatermarkOptions): Promise<Uint8Array> {
  if (!opts.text && !opts.imageBytes) throw new Error('Watermark needs text or an image.');
  const doc = await loadPdf(bytes);
  const opacity = opts.opacity ?? 0.15;
  const rotation = opts.rotationDegrees ?? 45;
  const font = opts.text ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const image = opts.imageBytes
    ? opts.imageType === 'jpg'
      ? await doc.embedJpg(opts.imageBytes)
      : await doc.embedPng(opts.imageBytes)
    : null;

  for (const page of doc.getPages()) {
    const pw = page.getWidth();
    const ph = page.getHeight();
    if (opts.text && font) {
      const size = opts.size ?? Math.min(pw, ph) / 8;
      const w = font.widthOfTextAtSize(opts.text, size);
      const c = opts.color ?? { r: 0.45, g: 0.45, b: 0.45 };
      // Center the rotated text: offset from center along the rotated baseline.
      const rad = (rotation * Math.PI) / 180;
      page.drawText(opts.text, {
        x: pw / 2 - (w / 2) * Math.cos(rad),
        y: ph / 2 - (w / 2) * Math.sin(rad),
        size,
        font,
        color: rgb(c.r, c.g, c.b),
        opacity,
        rotate: degrees(rotation),
      });
    } else if (image) {
      const targetW = opts.size ?? pw / 2;
      const scale = targetW / image.width;
      page.drawImage(image, {
        x: pw / 2 - (image.width * scale) / 2,
        y: ph / 2 - (image.height * scale) / 2,
        width: image.width * scale,
        height: image.height * scale,
        opacity,
        rotate: degrees(rotation),
      });
    }
  }
  return doc.save({ useObjectStreams: true });
}

import { loadPdf } from '../load';
import type { Rect } from './types';

export interface Stamp {
  pageIndex: number;
  imageBytes: Uint8Array;
  imageType: 'png' | 'jpg';
  rect: Rect; // placement in PDF points, bottom-left origin
  opacity?: number;
}

/** Place images/stamps (also the commit path for signatures/initials). */
export async function addStamps(bytes: Uint8Array, stamps: Stamp[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  for (const s of stamps) {
    const img =
      s.imageType === 'png' ? await doc.embedPng(s.imageBytes) : await doc.embedJpg(s.imageBytes);
    const page = doc.getPage(s.pageIndex);
    page.drawImage(img, {
      x: s.rect.x,
      y: s.rect.y,
      width: s.rect.width,
      height: s.rect.height,
      opacity: s.opacity ?? 1,
    });
  }
  return doc.save({ useObjectStreams: true });
}

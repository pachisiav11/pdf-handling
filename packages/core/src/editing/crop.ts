import { loadPdf, PdfUserError } from '../load';
import type { Rect } from './types';

/** Crop pages to `box` (PDF points, bottom-left origin). `indices` omitted = all pages. */
export async function cropPages(
  bytes: Uint8Array,
  box: Rect,
  indices?: number[],
): Promise<Uint8Array> {
  if (box.width <= 0 || box.height <= 0) {
    throw new PdfUserError('Crop area must have a positive width and height.', 'invalid-range');
  }
  const doc = await loadPdf(bytes);
  const count = doc.getPageCount();
  const targets = indices ?? Array.from({ length: count }, (_, i) => i);
  for (const i of targets) {
    if (i < 0 || i >= count) {
      throw new PdfUserError(
        `Page ${i + 1} does not exist — this document has ${count} page${count === 1 ? '' : 's'}.`,
        'invalid-range',
      );
    }
    const page = doc.getPage(i);
    page.setCropBox(box.x, box.y, box.width, box.height);
  }
  return doc.save({ useObjectStreams: true });
}

import { degrees } from 'pdf-lib';
import { loadPdf, PdfUserError } from './load';

export type RotationDelta = 90 | 180 | 270;

/**
 * Rotate pages by `delta` degrees clockwise, added to each page's existing rotation.
 * `indices` is 0-based; omit to rotate the whole document.
 */
export async function rotatePages(
  bytes: Uint8Array,
  delta: RotationDelta,
  indices?: number[],
): Promise<Uint8Array> {
  if (![90, 180, 270].includes(delta)) {
    throw new PdfUserError('Rotation must be 90, 180, or 270 degrees.', 'unsupported');
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
    page.setRotation(degrees(((page.getRotation().angle + delta) % 360) as 0 | 90 | 180 | 270));
  }
  return doc.save({ useObjectStreams: true });
}

import { rgb, StandardFonts } from 'pdf-lib';
import { loadPdf } from '../load';

export type NumberPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right'
  | 'top-left';

export interface PageNumberOptions {
  position: NumberPosition;
  /** Format string; {n} = page number, {total} = page count. */
  format?: string;
  size?: number;
  startAt?: number; // first page to stamp, 0-based (e.g. skip a cover)
}

const MARGIN = 28;

/** Stamp "Page {n} of {total}"-style numbers onto every page. */
export async function addPageNumbers(
  bytes: Uint8Array,
  opts: PageNumberOptions,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.size ?? 10;
  const format = opts.format ?? 'Page {n} of {total}';
  const total = doc.getPageCount();
  for (let i = opts.startAt ?? 0; i < total; i++) {
    const page = doc.getPage(i);
    const label = format.replaceAll('{n}', String(i + 1)).replaceAll('{total}', String(total));
    const w = font.widthOfTextAtSize(label, size);
    const x = opts.position.endsWith('center')
      ? (page.getWidth() - w) / 2
      : opts.position.endsWith('right')
        ? page.getWidth() - MARGIN - w
        : MARGIN;
    const y = opts.position.startsWith('bottom') ? MARGIN - size / 2 : page.getHeight() - MARGIN;
    page.drawText(label, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
  }
  return doc.save({ useObjectStreams: true });
}

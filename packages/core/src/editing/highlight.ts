import { rgb } from 'pdf-lib';
import { loadPdf } from '../load';
import { HIGHLIGHT_YELLOW, type Rect, type RGB } from './types';

export type MarkupKind = 'highlight' | 'underline' | 'strikethrough';

export interface Markup {
  pageIndex: number;
  kind: MarkupKind;
  rects: Rect[]; // text-line bounding boxes from the pdf.js text layer
  color?: RGB;
}

/** Draw highlight/underline/strikethrough over text-line rects. */
export async function addMarkups(bytes: Uint8Array, markups: Markup[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  for (const m of markups) {
    const page = doc.getPage(m.pageIndex);
    const c = m.color ?? (m.kind === 'highlight' ? HIGHLIGHT_YELLOW : { r: 0.86, g: 0.15, b: 0.15 });
    for (const r of m.rects) {
      if (m.kind === 'highlight') {
        page.drawRectangle({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          color: rgb(c.r, c.g, c.b),
          opacity: 0.35,
        });
      } else {
        const lineY = m.kind === 'underline' ? r.y - 1.5 : r.y + r.height / 2 - 1;
        page.drawRectangle({
          x: r.x,
          y: lineY,
          width: r.width,
          height: 1.6,
          color: rgb(c.r, c.g, c.b),
        });
      }
    }
  }
  return doc.save({ useObjectStreams: true });
}

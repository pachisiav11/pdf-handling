import { rgb, StandardFonts } from 'pdf-lib';
import { loadPdf } from '../load';
import type { RGB } from './types';

export interface TextItem {
  pageIndex: number;
  x: number;
  y: number; // baseline, PDF points from bottom-left
  text: string;
  size: number;
  color?: RGB;
  font?: 'helvetica' | 'helvetica-bold' | 'times' | 'courier';
}

const FONT_MAP = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
} as const;

/** Commit text overlays into the PDF content stream. */
export async function addTextItems(bytes: Uint8Array, items: TextItem[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const fonts = new Map<string, Awaited<ReturnType<typeof doc.embedFont>>>();
  for (const item of items) {
    const key = item.font ?? 'helvetica';
    if (!fonts.has(key)) fonts.set(key, await doc.embedFont(FONT_MAP[key]));
    const page = doc.getPage(item.pageIndex);
    const c = item.color ?? { r: 0, g: 0, b: 0 };
    page.drawText(item.text, {
      x: item.x,
      y: item.y,
      size: item.size,
      font: fonts.get(key)!,
      color: rgb(c.r, c.g, c.b),
    });
  }
  return doc.save({ useObjectStreams: true });
}

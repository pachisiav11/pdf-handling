import { PDFDocument } from 'pdf-lib';
import { loadPdf } from '../load';
import type { Rect } from './types';

export interface RedactRegion {
  pageIndex: number;
  rects: Rect[]; // PDF points, bottom-left origin
}

/**
 * Platform-supplied rasterizer: render page `pageIndex` of `bytes` at `scale`,
 * paint the given rects opaque black (rects are in PDF points, bottom-left
 * origin — implementations must convert to their canvas space), and return
 * PNG bytes of the whole page.
 */
export type RedactionRasterizer = (
  bytes: Uint8Array,
  pageIndex: number,
  scale: number,
  rects: Rect[],
) => Promise<Uint8Array>;

const REDACT_SCALE = 2; // 144dpi-equivalent, per the build guide's "2x for quality"

/**
 * True redaction: affected pages are re-rendered to bitmaps with the regions
 * painted black, then the original page (text, vectors, images — everything)
 * is replaced by that bitmap. No content survives underneath the box.
 * Tradeoff (surfaced in the UI): redacted pages become images — larger file,
 * no longer selectable/searchable.
 */
export async function redactRegions(
  bytes: Uint8Array,
  regions: RedactRegion[],
  rasterize: RedactionRasterizer,
): Promise<Uint8Array> {
  const byPage = new Map<number, Rect[]>();
  for (const r of regions) {
    byPage.set(r.pageIndex, [...(byPage.get(r.pageIndex) ?? []), ...r.rects]);
  }
  const replacements: PageImageReplacement[] = [];
  for (const [pageIndex, rects] of byPage) {
    if (rects.length === 0) continue;
    replacements.push({ pageIndex, png: await rasterize(bytes, pageIndex, REDACT_SCALE, rects) });
  }
  return replacePagesWithImages(bytes, replacements);
}

export interface PageImageReplacement {
  pageIndex: number;
  png: Uint8Array; // full-page bitmap (with redaction boxes already painted)
}

/**
 * Replace whole pages with full-page images, discarding the original content
 * stream entirely. The destructive half of redaction — split out so platforms
 * can rasterize wherever their canvas lives (renderer, worker, native).
 */
export async function replacePagesWithImages(
  bytes: Uint8Array,
  replacements: PageImageReplacement[],
): Promise<Uint8Array> {
  const byPage = new Map(replacements.map((r) => [r.pageIndex, r.png]));
  const src = await loadPdf(bytes);
  const out = await PDFDocument.create();
  const indices = src.getPageIndices();
  const copied = await out.copyPages(src, indices);

  for (const i of indices) {
    const png = byPage.get(i);
    if (!png) {
      out.addPage(copied[i]!);
      continue;
    }
    const original = copied[i]!;
    const w = original.getWidth();
    const h = original.getHeight();
    const img = await out.embedPng(png);
    const page = out.addPage([w, h]); // fresh page: none of the original content stream survives
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return out.save({ useObjectStreams: true });
}

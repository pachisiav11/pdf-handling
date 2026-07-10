import { rgb } from 'pdf-lib';
import { loadPdf } from '../load';
import type { RGB } from './types';

export interface Stroke {
  pageIndex: number;
  points: Array<{ x: number; y: number }>; // PDF points, bottom-left origin
  width: number;
  color?: RGB;
}

/** Commit freehand strokes as vector paths. */
export async function addStrokes(bytes: Uint8Array, strokes: Stroke[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    const page = doc.getPage(stroke.pageIndex);
    const c = stroke.color ?? { r: 0.1, g: 0.1, b: 0.1 };
    // drawSvgPath uses SVG space (y down, origin at the given x/y). Convert our
    // bottom-left PDF coords: place origin at the page top, flip y.
    const H = page.getHeight();
    const [first, ...rest] = stroke.points;
    const path =
      `M ${first!.x} ${H - first!.y} ` + rest.map((p) => `L ${p.x} ${H - p.y}`).join(' ');
    page.drawSvgPath(path, {
      x: 0,
      y: H,
      borderColor: rgb(c.r, c.g, c.b),
      borderWidth: stroke.width,
      scale: 1,
    });
  }
  return doc.save({ useObjectStreams: true });
}

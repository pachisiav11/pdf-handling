import { PDFDocument } from 'pdf-lib';
import { loadPdf, PdfUserError } from './load';

function assertValidIndices(indices: number[], pageCount: number): void {
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= pageCount) {
      throw new PdfUserError(
        `Page ${i + 1} does not exist — this document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
        'invalid-range',
      );
    }
  }
}

/** Remove the given 0-based pages. Refuses to delete every page. */
export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const count = doc.getPageCount();
  assertValidIndices(indices, count);
  const unique = [...new Set(indices)];
  if (unique.length >= count) {
    throw new PdfUserError('Cannot delete every page — a PDF needs at least one.', 'invalid-range');
  }
  // Delete from highest index down so earlier removals don't shift later ones.
  for (const i of unique.sort((a, b) => b - a)) doc.removePage(i);
  return doc.save({ useObjectStreams: true });
}

/** Copy the given 0-based pages (in the given order) into a new document. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  assertValidIndices(indices, src.getPageCount());
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  return out.save({ useObjectStreams: true });
}

/**
 * Rebuild the document with pages in `newOrder` (a permutation of all current
 * 0-based indices — e.g. [2,0,1] moves page 3 to the front).
 */
export async function reorderPages(bytes: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const count = src.getPageCount();
  if (newOrder.length !== count || new Set(newOrder).size !== count) {
    throw new PdfUserError(
      `Reorder list must contain each of the ${count} pages exactly once.`,
      'invalid-range',
    );
  }
  assertValidIndices(newOrder, count);
  return extractPages(bytes, newOrder);
}

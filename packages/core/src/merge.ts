import { PDFDocument } from 'pdf-lib';
import { loadPdf } from './load';

/**
 * Merge multiple PDFs into one, preserving each file's internal page order.
 * `sources` order is the merge order — callers let the user reorder before calling.
 */
export async function mergePdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of sources) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save({ useObjectStreams: true });
}

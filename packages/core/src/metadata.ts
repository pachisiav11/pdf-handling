import { loadPdf } from './load';

/**
 * Title-only document metadata (build guide "Metadata editor (title only for
 * v1.1)"). Intentionally scoped to the title — author/subject/keywords/producer
 * editing is explicitly out of scope for v1.1.
 */

/** Read the current document title, or '' if none is set. */
export async function getTitle(bytes: Uint8Array): Promise<string> {
  const doc = await loadPdf(bytes);
  return doc.getTitle() ?? '';
}

/** Set (or clear, with '') the document title and return the updated bytes. */
export async function setTitle(bytes: Uint8Array, title: string): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.setTitle(title);
  return doc.save({ useObjectStreams: true });
}

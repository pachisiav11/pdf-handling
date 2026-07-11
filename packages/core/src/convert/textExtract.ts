import { extractText } from '../view';

/** Extract all text as one plain-text string (pages separated by blank lines). */
export async function extractPlainText(bytes: Uint8Array): Promise<string> {
  const pages = await extractText(bytes);
  return pages
    .map((text, i) => `--- Page ${i + 1} ---\n${text}`)
    .join('\n\n')
    .trim();
}

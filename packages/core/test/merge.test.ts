import { describe, expect, it } from 'vitest';
import { mergePdfs } from '../src/merge';
import { getPageCount } from '../src/load';
import { extractText } from '../src/view';
import { textPdf, mixedSizePdf } from './fixtures';

describe('mergePdfs', () => {
  it('concatenates documents preserving per-file page order', async () => {
    const a = await textPdf();
    const b = await mixedSizePdf();
    const merged = await mergePdfs([a, b]);
    expect(await getPageCount(merged)).toBe(8);
    const text = await extractText(merged);
    expect(text[0]).toContain('FIXTURE-PAGE-1');
    expect(text[4]).toContain('FIXTURE-PAGE-5');
    expect(text[5]).toContain('SIZE-PAGE-1');
  });

  it('respects the given source order', async () => {
    const a = await textPdf();
    const b = await mixedSizePdf();
    const merged = await mergePdfs([b, a]);
    const text = await extractText(merged);
    expect(text[0]).toContain('SIZE-PAGE-1');
    expect(text[3]).toContain('FIXTURE-PAGE-1');
  });
});

import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { parsePageRanges, splitByRange, splitToSinglePages } from '../src/split';
import { getPageCount, PdfUserError } from '../src/load';
import { extractText } from '../src/view';
import { textPdf } from './fixtures';

describe('parsePageRanges', () => {
  it('parses mixed singles and ranges to 0-based indices', () => {
    expect(parsePageRanges('1-3,5', 5)).toEqual([0, 1, 2, 4]);
  });

  it('rejects out-of-bounds ranges with an actionable message', () => {
    expect(() => parsePageRanges('5-12', 8)).toThrowError(/document has 8 pages/);
  });

  it('rejects malformed input', () => {
    expect(() => parsePageRanges('1-x', 5)).toThrowError(PdfUserError);
    expect(() => parsePageRanges('', 5)).toThrowError(PdfUserError);
    expect(() => parsePageRanges('3-1', 5)).toThrowError(PdfUserError);
  });
});

describe('splitByRange', () => {
  it('extracts exactly the requested pages', async () => {
    const src = await textPdf();
    const out = await splitByRange(src, '2-3,5');
    expect(await getPageCount(out)).toBe(3);
    const text = await extractText(out);
    expect(text[0]).toContain('FIXTURE-PAGE-2');
    expect(text[1]).toContain('FIXTURE-PAGE-3');
    expect(text[2]).toContain('FIXTURE-PAGE-5');
  });
});

describe('splitToSinglePages', () => {
  it('produces a zip with one single-page PDF per page', async () => {
    const src = await textPdf();
    const zip = await splitToSinglePages(src, 'doc');
    const entries = unzipSync(zip);
    const names = Object.keys(entries).sort();
    expect(names).toEqual([
      'doc-page-1.pdf',
      'doc-page-2.pdf',
      'doc-page-3.pdf',
      'doc-page-4.pdf',
      'doc-page-5.pdf',
    ]);
    expect(await getPageCount(entries['doc-page-3.pdf']!)).toBe(1);
    const text = await extractText(entries['doc-page-3.pdf']!);
    expect(text[0]).toContain('FIXTURE-PAGE-3');
  });
});

import { describe, expect, it } from 'vitest';
import { deletePages, extractPages, reorderPages } from '../src/pages';
import { getPageCount, PdfUserError } from '../src/load';
import { extractText } from '../src/view';
import { textPdf } from './fixtures';

describe('deletePages', () => {
  it('removes the given pages', async () => {
    const out = await deletePages(await textPdf(), [1, 3]); // drop pages 2 and 4
    expect(await getPageCount(out)).toBe(3);
    const text = await extractText(out);
    expect(text.join(' ')).toContain('FIXTURE-PAGE-1');
    expect(text.join(' ')).not.toContain('FIXTURE-PAGE-2');
    expect(text.join(' ')).not.toContain('FIXTURE-PAGE-4');
  });

  it('refuses to delete every page', async () => {
    await expect(deletePages(await textPdf(), [0, 1, 2, 3, 4])).rejects.toThrowError(PdfUserError);
  });
});

describe('extractPages', () => {
  it('copies the requested pages into a new document', async () => {
    const out = await extractPages(await textPdf(), [4, 0]);
    expect(await getPageCount(out)).toBe(2);
    const text = await extractText(out);
    expect(text[0]).toContain('FIXTURE-PAGE-5');
    expect(text[1]).toContain('FIXTURE-PAGE-1');
  });
});

describe('reorderPages', () => {
  it('rebuilds the document in the new order', async () => {
    const out = await reorderPages(await textPdf(), [4, 3, 2, 1, 0]);
    const text = await extractText(out);
    expect(text[0]).toContain('FIXTURE-PAGE-5');
    expect(text[4]).toContain('FIXTURE-PAGE-1');
  });

  it('rejects a non-permutation', async () => {
    await expect(reorderPages(await textPdf(), [0, 0, 1, 2, 3])).rejects.toThrowError(
      PdfUserError,
    );
  });
});

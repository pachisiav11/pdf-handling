import { describe, expect, it } from 'vitest';
import { redactRegions } from '../src/editing/redact';
import { createNodeRedactionRasterizer } from '../src/editing/redact-node';
import { extractText } from '../src/view';
import { getPageCount } from '../src/load';
import { textPdf } from './fixtures';

/**
 * Phase 3 acceptance test (build guide): after redacting, extract text from
 * the output and confirm the redacted content does NOT appear anywhere.
 * This proves real content destruction, not a cosmetic box.
 */
describe('redactRegions', () => {
  it('destroys the underlying text of the redacted page', async () => {
    const src = await textPdf();
    const before = await extractText(src);
    expect(before[0]).toContain('FIXTURE-PAGE-1');

    // Redact the headline area of page 1 (it sits at y≈720, size 24).
    const out = await redactRegions(
      src,
      [{ pageIndex: 0, rects: [{ x: 40, y: 700, width: 400, height: 60 }] }],
      createNodeRedactionRasterizer(),
    );

    const after = await extractText(out);
    // The whole page became an image — no text at all survives on it.
    expect(after[0]).not.toContain('FIXTURE-PAGE-1');
    expect(after[0]!.trim()).toBe('');
    // Untouched pages keep their text.
    expect(after[1]).toContain('FIXTURE-PAGE-2');
    expect(await getPageCount(out)).toBe(5);
  });

  it('keeps page dimensions identical', async () => {
    const src = await textPdf();
    const out = await redactRegions(
      src,
      [{ pageIndex: 2, rects: [{ x: 100, y: 100, width: 100, height: 50 }] }],
      createNodeRedactionRasterizer(),
    );
    const { loadPdf } = await import('../src/load');
    const doc = await loadPdf(out);
    expect(doc.getPage(2).getWidth()).toBe(612);
    expect(doc.getPage(2).getHeight()).toBe(792);
  });
});

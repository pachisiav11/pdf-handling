import { describe, expect, it } from 'vitest';
import { rotatePages } from '../src/rotate';
import { loadPdf } from '../src/load';
import { textPdf } from './fixtures';

describe('rotatePages', () => {
  it('rotates the whole document by 90°', async () => {
    const out = await rotatePages(await textPdf(), 90);
    const doc = await loadPdf(out);
    for (let i = 0; i < doc.getPageCount(); i++) {
      expect(doc.getPage(i).getRotation().angle).toBe(90);
    }
  });

  it('rotates only selected pages and accumulates rotation', async () => {
    const once = await rotatePages(await textPdf(), 90, [0]);
    const twice = await rotatePages(once, 90, [0]);
    const doc = await loadPdf(twice);
    expect(doc.getPage(0).getRotation().angle).toBe(180);
    expect(doc.getPage(1).getRotation().angle).toBe(0);
  });

  it('wraps past 360°', async () => {
    const r270 = await rotatePages(await textPdf(), 270, [0]);
    const wrapped = await rotatePages(r270, 180, [0]);
    const doc = await loadPdf(wrapped);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });
});

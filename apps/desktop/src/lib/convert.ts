/** Renderer-side conversion flows (Phase 5). */
import { extractPlainText, type OcrPageResult } from '@pdfx/core';
import { zipSync } from 'fflate';
import { ops } from '../pdf/opsClient';
import { getRenderDoc } from '../pdf/render';
import { getState, openBytes, runExportOp, showNotice } from '../state/store';
import { saveBytesAs } from './files';

/** Images → PDF: native picker, convert in the worker, open the result. */
export async function imagesToPdfFlow(): Promise<void> {
  const files = await window.pdfx.openImages();
  if (!files.length) return;
  const images = files.map((f) => ({
    bytes: new Uint8Array(f.bytes),
    type: f.fileName.toLowerCase().endsWith('.png') ? ('png' as const) : ('jpg' as const),
  }));
  const bytes = await runExportOp(`Converting ${images.length} image(s)`, () =>
    ops.imagesToPdf(images, 'fit'),
  );
  if (bytes) await openBytes('images.pdf', bytes);
}

/** Office → PDF via LibreOffice in the main process; opens the converted doc. */
export async function officeToPdfFlow(): Promise<void> {
  const result = await window.pdfx.convertOffice();
  if (!result) return; // cancelled
  if ('error' in result) {
    showNotice(result.error);
    return;
  }
  await openBytes(result.fileName, new Uint8Array(result.bytes));
  showNotice(`Converted ${result.fileName} — save it wherever you like.`);
}

/** Active doc → per-page PNGs at 150dpi, zipped (single page saves directly). */
export async function exportImagesFlow(): Promise<void> {
  const doc = getState().docs.find((d) => d.id === getState().activeId);
  if (!doc) return;
  const base = doc.fileName.replace(/\.pdf$/i, '');
  const scale = 150 / 72;
  const renderDoc = await getRenderDoc(doc.id, doc.version, doc.bytes);
  const result = await runExportOp(`Rendering ${doc.pageCount} page(s) to PNG`, async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < doc.pageCount; i++) {
      const page = await renderDoc.getPage(i + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'),
      );
      entries[`${base}-page-${i + 1}.png`] = new Uint8Array(await blob.arrayBuffer());
    }
    if (doc.pageCount === 1) return entries[`${base}-page-1.png`]!;
    return zipSync(entries, { level: 0 });
  });
  if (result) {
    await saveBytesAs(
      doc.pageCount === 1 ? `${base}.png` : `${base}-pages.zip`,
      result,
      doc.pageCount === 1 ? ('png') : 'zip',
    );
  }
}

/** Active doc → plain .txt. */
export async function exportTextFlow(): Promise<void> {
  const doc = getState().docs.find((d) => d.id === getState().activeId);
  if (!doc) return;
  const text = await runExportOp('Extracting text', async () =>
    new TextEncoder().encode(await extractPlainText(doc.bytes)),
  );
  if (text) {
    await saveBytesAs(doc.fileName.replace(/\.pdf$/i, '.txt'), text, 'txt');
  }
}

/** OCR the active doc in the main process; returns per-page results. */
export async function ocrFlow(
  onProgress: (done: number, total: number) => void,
): Promise<OcrPageResult[] | null> {
  const doc = getState().docs.find((d) => d.id === getState().activeId);
  if (!doc) return null;
  const off = window.pdfx.onOcrProgress((p) => onProgress(p.done, p.total));
  try {
    const buf = doc.bytes.buffer.slice(
      doc.bytes.byteOffset,
      doc.bytes.byteOffset + doc.bytes.byteLength,
    );
    const result = (await window.pdfx.runOcr(buf as ArrayBuffer)) as
      | OcrPageResult[]
      | { error: string };
    if ('error' in result) {
      showNotice(String(result.error));
      return null;
    }
    return result;
  } finally {
    off();
  }
}

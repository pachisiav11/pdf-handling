import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Deterministic test fixtures, generated on first use and cached in
 * test-fixtures/ (committed so tests also run without a generation step).
 */
const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures');

async function cached(name: string, gen: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const path = join(FIXTURES_DIR, name);
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    const bytes = await gen();
    await mkdir(FIXTURES_DIR, { recursive: true });
    await writeFile(path, bytes);
    return bytes;
  }
}

/** 5-page text PDF; page N contains the marker "FIXTURE-PAGE-N" plus filler text. */
export function textPdf(): Promise<Uint8Array> {
  return cached('text-5pages.pdf', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= 5; n++) {
      const page = doc.addPage([612, 792]); // US Letter
      page.drawText(`FIXTURE-PAGE-${n}`, { x: 50, y: 720, size: 24, font });
      page.drawText(`This is sample body text on page ${n} of the fixture document.`, {
        x: 50,
        y: 680,
        size: 12,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
    return doc.save();
  });
}

/** Single-page PDF containing one large embedded JPEG (for compress/OCR-ish tests). */
export function imagePdf(): Promise<Uint8Array> {
  return cached('image-1page.pdf', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(2400, 1800);
    const ctx = canvas.getContext('2d');
    // Noisy gradient so JPEG re-encode at lower quality/scale meaningfully shrinks it.
    for (let y = 0; y < 1800; y += 4) {
      for (let x = 0; x < 2400; x += 4) {
        ctx.fillStyle = `rgb(${(x * 7) % 256},${(y * 5) % 256},${((x + y) * 3) % 256})`;
        ctx.fillRect(x, y, 4, 4);
      }
    }
    const jpeg = canvas.toBuffer('image/jpeg', 95);
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(jpeg);
    const page = doc.addPage([612, 459]);
    page.drawImage(img, { x: 0, y: 0, width: 612, height: 459 });
    return doc.save();
  });
}

/** PDF whose pages have mismatched sizes (Letter, A5-ish, wide). */
export function mixedSizePdf(): Promise<Uint8Array> {
  return cached('mixed-sizes.pdf', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sizes: Array<[number, number]> = [
      [612, 792],
      [420, 595],
      [842, 400],
    ];
    sizes.forEach(([w, h], i) => {
      const page = doc.addPage([w, h]);
      page.drawText(`SIZE-PAGE-${i + 1}`, { x: 40, y: h - 60, size: 18, font });
    });
    return doc.save();
  });
}

/** "Scanned" PDF: one page that is only an image of rendered text (for OCR). */
export function scannedPdf(): Promise<Uint8Array> {
  return cached('scanned-text.pdf', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(1224, 1584); // Letter at 2x
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1224, 1584);
    ctx.fillStyle = '#111';
    ctx.font = '48px Arial';
    ctx.fillText('The quick brown fox jumps', 100, 220);
    ctx.fillText('over the lazy dog', 100, 300);
    ctx.font = '36px Arial';
    ctx.fillText('OCR VERIFICATION SAMPLE 12345', 100, 420);
    const jpeg = canvas.toBuffer('image/jpeg', 92);
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(jpeg);
    const page = doc.addPage([612, 792]);
    page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
    return doc.save();
  });
}

/** PDF with AcroForm fields: a text field and a checkbox. */
export function formPdf(): Promise<Uint8Array> {
  return cached('acroform.pdf', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const nameField = form.createTextField('applicant.name');
    nameField.addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
    const agreeBox = form.createCheckBox('applicant.agree');
    agreeBox.addToPage(page, { x: 50, y: 650, width: 18, height: 18 });
    return doc.save();
  });
}

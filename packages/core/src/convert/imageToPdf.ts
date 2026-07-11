import { PDFDocument } from 'pdf-lib';

export interface ImageInput {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

export type ImagePageSize = 'fit' | 'a4' | 'letter';

const PAGE_SIZES: Record<Exclude<ImagePageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Convert images to a PDF — one page per image, in the given order.
    'fit' sizes each page to its image; a4/letter centers the image scaled to fit. */
export async function imagesToPdf(
  images: ImageInput[],
  pageSize: ImagePageSize = 'fit',
): Promise<Uint8Array> {
  if (!images.length) throw new Error('No images given.');
  const doc = await PDFDocument.create();
  for (const input of images) {
    const img =
      input.type === 'png' ? await doc.embedPng(input.bytes) : await doc.embedJpg(input.bytes);
    if (pageSize === 'fit') {
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const [pw, ph] = PAGE_SIZES[pageSize];
      const page = doc.addPage([pw, ph]);
      const margin = 24;
      const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  return doc.save({ useObjectStreams: true });
}

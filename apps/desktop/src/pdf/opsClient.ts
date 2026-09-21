import { createILovePdfClient } from '@pdfx/ilovepdf-api';

/** Public iLovePDF project ID. The private key is never exposed to this renderer. */
const PUBLIC_KEY = 'project_public_3e6ebf6c7fe3800ecb67d9305ac66106_5TVOU661190bc6af1630f8f86d5ae8d465313';

const client = createILovePdfClient({
  publicKey: PUBLIC_KEY,
  region: 'in',
  // Packaged Electron obtains an HMAC-signed, one-hour token from the main
  // process. Resolved per call because the bridge is absent in plain-browser
  // development, where a nullish token falls back to iLovePDF's /auth flow.
  tokenProvider: async () => (globalThis as unknown as Partial<Window>).pdfx?.apiToken?.(),
});

const pdf = (bytes: Uint8Array, name = 'document.pdf', rotate?: 0 | 90 | 180 | 270) => ({
  name,
  bytes,
  mimeType: 'application/pdf',
  rotate,
});

function unsupported<T>(name: string): Promise<T> {
  return Promise.reject(new Error(`${name} is not available in the iLovePDF API workflow.`));
}

function position(position: import('@pdfx/core').NumberPosition): { vertical: 'top' | 'bottom'; horizontal: 'left' | 'center' | 'right' } {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  return { vertical, horizontal };
}

/** All document mutations in the desktop UI now use iLovePDF's REST API. */
export const ops = {
  merge: (sources: Uint8Array[]) => client.process('merge', sources.map((bytes, index) => pdf(bytes, `merge-${index + 1}.pdf`))),
  splitRange: (bytes: Uint8Array, range: string) =>
    client.process('split', [pdf(bytes)], { split_mode: 'ranges', ranges: range, merge_after: true }),
  /** Returns ZIP archive bytes, not a PDF: iLovePDF packages multi-file output. */
  splitAll: async (bytes: Uint8Array, baseName: string): Promise<Uint8Array> => {
    const result = await client.processDetailed('split', [pdf(bytes)], {
      split_mode: 'fixed_range',
      fixed_range: 1,
      packaged_filename: baseName || 'pages',
    });
    if (!result.archive) {
      throw new Error('iLovePDF returned a single PDF: a one-page document cannot be split.');
    }
    return result.bytes;
  },
  deletePages: (bytes: Uint8Array, indices: number[]) =>
    client.process('split', [pdf(bytes)], { split_mode: 'remove_pages', remove_pages: indices.map((i) => i + 1).join(',') }),
  extractPages: (bytes: Uint8Array, indices: number[]) =>
    client.process('split', [pdf(bytes)], { split_mode: 'ranges', ranges: indices.map((i) => i + 1).join(','), merge_after: true }),
  reorderPages: (_bytes: Uint8Array, _newOrder: number[]) => unsupported<Uint8Array>('Page reordering'),
  rotatePages: (bytes: Uint8Array, delta: 90 | 180 | 270, indices?: number[]) =>
    indices?.length
      ? unsupported<Uint8Array>('Rotating selected pages')
      : client.process('rotate', [pdf(bytes, 'document.pdf', delta)]),
  compress: (bytes: Uint8Array, preset: 'low' | 'medium' | 'high') =>
    client.process('compress', [pdf(bytes)], {
      compression_level: preset === 'high' ? 'extreme' : preset === 'medium' ? 'recommended' : 'low',
    }),
  compressTarget: (_bytes: Uint8Array, _targetBytes: number) =>
    unsupported<import('@pdfx/core').TargetSizeResult>('Target-size compression'),
  normalize: (_bytes: Uint8Array, _size: import('@pdfx/core').PaperSize) => unsupported<Uint8Array>('Page-size normalization'),
  setTitle: (bytes: Uint8Array, title: string) =>
    client.process('rotate', [pdf(bytes)], { metas: { Title: title } }),
  searchableLayer: (_bytes: Uint8Array, _pages: import('@pdfx/core').OcrPageResult[]) =>
    unsupported<Uint8Array>('Searchable text layers'),
  addText: (_bytes: Uint8Array, _items: import('@pdfx/core').TextItem[]) => unsupported<Uint8Array>('Text editing'),
  addMarkups: (_bytes: Uint8Array, _markups: import('@pdfx/core').Markup[]) => unsupported<Uint8Array>('Markup editing'),
  addStrokes: (_bytes: Uint8Array, _strokes: import('@pdfx/core').Stroke[]) => unsupported<Uint8Array>('Drawing'),
  addStamps: (_bytes: Uint8Array, _stamps: import('@pdfx/core').Stamp[]) => unsupported<Uint8Array>('Image placement'),
  pageNumbers: (bytes: Uint8Array, options: import('@pdfx/core').PageNumberOptions) => {
    const placement = position(options.position);
    // startAt is the 0-based first page to stamp, not the first label value.
    const firstPage = Math.max(0, Math.trunc(options.startAt ?? 0));
    return client.process('pagenumber', [pdf(bytes)], {
      pages: firstPage > 0 ? `${firstPage + 1}-end` : 'all',
      starting_number: firstPage + 1,
      vertical_position: placement.vertical,
      horizontal_position: placement.horizontal,
      text: (options.format ?? 'Page {n} of {total}').replaceAll('{total}', '{p}'),
      font_size: options.size ?? 10,
    });
  },
  watermark: (bytes: Uint8Array, options: import('@pdfx/core').WatermarkOptions) =>
    options.text
      ? client.process('watermark', [pdf(bytes)], {
          mode: 'text',
          text: options.text,
          pages: 'all',
          mosaic: false,
          vertical_position: 'middle',
          horizontal_position: 'center',
          rotation: options.rotationDegrees ?? 45,
          // iLovePDF's `transparency` is a percentage of opacity, range 1-100.
          transparency: Math.min(100, Math.max(1, Math.round((options.opacity ?? 0.15) * 100))),
          ...(options.size ? { font_size: options.size } : {}),
        })
      : unsupported<Uint8Array>('Image watermarking'),
  crop: (_bytes: Uint8Array, _box: import('@pdfx/core').Rect, _indices?: number[]) => unsupported<Uint8Array>('PDF cropping'),
  replacePages: (_bytes: Uint8Array, _replacements: import('@pdfx/core').PageImageReplacement[]) => unsupported<Uint8Array>('Redaction'),
  imagesToPdf: (images: import('@pdfx/core').ImageInput[], pageSize: import('@pdfx/core').ImagePageSize) =>
    client.process('imagepdf', images.map((image, index) => ({
      name: `image-${index + 1}.${image.type}`,
      bytes: image.bytes,
      mimeType: image.type === 'png' ? 'image/png' : 'image/jpeg',
    })), { pagesize: pageSize === 'a4' ? 'A4' : pageSize, merge_after: true }),
  listFields: (_bytes: Uint8Array) => unsupported<import('@pdfx/core').FieldInfo[]>('Form fields'),
  fillFields: (_bytes: Uint8Array, _values: import('@pdfx/core').FieldValue[]) => unsupported<Uint8Array>('Form filling'),
  createFields: (_bytes: Uint8Array, _specs: import('@pdfx/core').NewFieldSpec[]) => unsupported<Uint8Array>('Form creation'),
};

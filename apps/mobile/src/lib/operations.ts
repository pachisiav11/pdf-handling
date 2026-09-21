import { createILovePdfClient } from '@pdfx/ilovepdf-api';
import type { CompressPreset, NumberPosition } from '@pdfx/core/mobile';

type TargetSizeResult =
  | { ok: true; bytes: Uint8Array; size: number; knob: number }
  | { ok: false; smallestSize: number; smallestBytes: Uint8Array; message: string };

const client = createILovePdfClient({
  publicKey: 'project_public_3e6ebf6c7fe3800ecb67d9305ac66106_5TVOU661190bc6af1630f8f86d5ae8d465313',
  region: 'in',
});

const pdf = (bytes: Uint8Array, name = 'document.pdf', rotate?: 0 | 90 | 180 | 270) => ({
  name,
  bytes,
  mimeType: 'application/pdf',
  rotate,
});

function unavailable<T>(name: string): Promise<T> {
  return Promise.reject(new Error(`${name} is not offered by the iLovePDF API workflow.`));
}

export function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  return client.process('merge', files.map((bytes, index) => pdf(bytes, `merge-${index + 1}.pdf`)));
}

export function splitByRange(bytes: Uint8Array, range: string): Promise<Uint8Array> {
  return client.process('split', [pdf(bytes)], { split_mode: 'ranges', ranges: range, merge_after: true });
}

export function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  return client.process('split', [pdf(bytes)], { split_mode: 'remove_pages', remove_pages: indices.map((index) => index + 1).join(',') });
}

export function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  return client.process('split', [pdf(bytes)], {
    split_mode: 'ranges',
    ranges: indices.map((index) => index + 1).join(','),
    merge_after: true,
  });
}

export function rotatePages(bytes: Uint8Array, delta: 90 | 180 | 270, indices?: number[]): Promise<Uint8Array> {
  return indices?.length
    ? unavailable('Rotating selected pages')
    : client.process('rotate', [pdf(bytes, 'document.pdf', delta)]);
}

export function reorderPages(_bytes: Uint8Array, _order: number[]): Promise<Uint8Array> {
  return unavailable('Page reordering');
}

export function compressPdf(bytes: Uint8Array, preset: CompressPreset): Promise<Uint8Array> {
  return client.process('compress', [pdf(bytes)], {
    compression_level: preset === 'high' ? 'extreme' : preset === 'medium' ? 'recommended' : 'low',
  });
}

export function addWatermark(bytes: Uint8Array, options: { text: string; opacity?: number }): Promise<Uint8Array> {
  return client.process('watermark', [pdf(bytes)], {
    mode: 'text',
    text: options.text,
    pages: 'all',
    mosaic: false,
    vertical_position: 'middle',
    horizontal_position: 'center',
    rotation: 45,
    // iLovePDF's `transparency` is a percentage of opacity, range 1-100.
    transparency: Math.min(100, Math.max(1, Math.round((options.opacity ?? 0.15) * 100))),
  });
}

export function addPageNumbers(
  bytes: Uint8Array,
  options: { position: NumberPosition; startAt?: number },
): Promise<Uint8Array> {
  const [vertical, horizontal] = options.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  // startAt is the 0-based first page to stamp, not the first label value.
  const firstPage = Math.max(0, Math.trunc(options.startAt ?? 0));
  return client.process('pagenumber', [pdf(bytes)], {
    pages: firstPage > 0 ? `${firstPage + 1}-end` : 'all',
    starting_number: firstPage + 1,
    vertical_position: vertical,
    horizontal_position: horizontal,
    text: 'Page {n} of {p}',
    font_size: 10,
  });
}

export function compressToTargetSize(_bytes: Uint8Array, _target: number): Promise<TargetSizeResult> {
  return unavailable<TargetSizeResult>('Target-size compression');
}

export function normalizePageSize(_bytes: Uint8Array, _size: string): Promise<Uint8Array> {
  return unavailable<Uint8Array>('Page-size normalization');
}

export function setTitle(bytes: Uint8Array, title: string): Promise<Uint8Array> {
  return client.process('rotate', [pdf(bytes)], { metas: { Title: title } });
}

export function getTitle(_bytes: Uint8Array): Promise<string> {
  return unavailable<string>('Reading PDF metadata');
}

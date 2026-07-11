export * from './types';
export * from './load';
export * from './editing/types';
export * from './editing/text';
export * from './editing/highlight';
export * from './editing/draw';
export * from './editing/stamp';
export * from './editing/pageNumbers';
export * from './editing/watermark';
export * from './editing/crop';
export * from './editing/redact';
export * from './forms/fill';
export * from './forms/create';
export * from './convert/imageToPdf';
export * from './convert/pdfToImage';
export * from './convert/textExtract';
export * from './convert/ocr';
// convert/officeConvert is intentionally NOT exported here — it is Node-only
// (spawns LibreOffice); desktop imports it via '@pdfx/core/convert/officeConvert'.
export * from './merge';
export * from './split';
export * from './pages';
export * from './rotate';
export * from './compress';
export * from './view';

/** Trivial function proving the shared-package import path works from both apps (Phase 0). */
export function ping(): string {
  return 'pong from @pdfx/core';
}

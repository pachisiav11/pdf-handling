/**
 * Mobile-safe surface of @pdfx/core.
 *
 * React Native (Hermes) has no DOM/`canvas` and no Node APIs, so the mobile app
 * must NOT pull in the modules that depend on them — `pdfjs-dist` (rendering /
 * text extraction), `tesseract.js` (OCR), `@napi-rs/canvas`, or the LibreOffice
 * bridge. Importing the package barrel (`@pdfx/core`) would drag all of those
 * into the Metro bundle.
 *
 * This entry re-exports only the pure `pdf-lib` operations, which run fine on
 * Hermes: the full Phase-1 core toolset plus the two editing tools that need no
 * on-screen placement (watermark, page numbers). Import it as
 * `@pdfx/core/mobile`.
 */
export { loadPdf, getPageCount, PdfUserError } from './load';
export { mergePdfs } from './merge';
export { parsePageRanges, splitByRange, splitToSinglePages } from './split';
export { deletePages, extractPages, reorderPages } from './pages';
export { rotatePages, type RotationDelta } from './rotate';
export {
  compressPdf,
  compressToTargetSize,
  type CompressPreset,
  type TargetSizeResult,
} from './compress';
export { addWatermark, type WatermarkOptions } from './editing/watermark';
export { addPageNumbers, type PageNumberOptions, type NumberPosition } from './editing/pageNumbers';

// Phase 9 (v1.1) — all pure pdf-lib / plain-JS, safe on Hermes.
export { normalizePageSize, type PaperSize } from './normalize';
export { getTitle, setTitle } from './metadata';
export { DocumentHistory, type HistoryLimits } from './history';
export {
  runBatch,
  type BatchItem,
  type BatchItemStatus,
  type BatchSummary,
  type BatchOptions,
} from './batch';

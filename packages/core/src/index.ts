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

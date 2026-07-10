export * from './types';
export * from './load';
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

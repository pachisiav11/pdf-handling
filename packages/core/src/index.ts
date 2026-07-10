export * from './types';

/** Trivial function proving the shared-package import path works from both apps (Phase 0). */
export function ping(): string {
  return 'pong from @pdfx/core';
}

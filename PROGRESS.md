# Progress

Phase tracker for the offline PDF editor build. One section is appended per completed phase — see `build_guide.md` for the full spec.

## Phase 0 — Scaffolding (2026-07-10)
Shipped:
- pnpm monorepo: `packages/core` (`@pdfx/core`), `packages/ui-components` (`@pdfx/ui`), `apps/desktop` (Electron + electron-vite + React 19), `apps/mobile` (bare React Native 0.86, Android)
- Shared root config: `tsconfig.base.json`, ESLint/Prettier, `.gitignore` excluding large native binaries
- Desktop: window launches, renderer imports `ping()` from `@pdfx/core`, native file-open dialog works over a contextIsolated IPC bridge
- Mobile: RN skeleton with `@react-native-documents/picker` PDF picker and `@pdfx/core` import, monorepo-aware Metro config
- Public GitHub repo created: https://github.com/pachisiav11/pdf-handling

Tested:
- `pnpm --filter @pdfx/core test` (vitest) passes; `tsc --noEmit` clean for core + desktop
- Desktop app built (`electron-vite build`) and launched manually — window renders, core import verified

Known gaps / deferred:
- Mobile app not yet built/run on a device — deferred to Phase 7 (desktop leads per workflow rule 6); Metro/Gradle configs are in place but unverified
- **Toolchain note:** pnpm 11 reproducibly hangs at the dependency-linking step on this workspace (Windows); pnpm 9.15.9 works (51s full install). `packageManager` is pinned to pnpm@9.15.9 — don't upgrade to 11 without re-testing.

Offline verification: n/a for this phase (no PDF features yet); no network code exists in the app beyond dev-server tooling.

## Phase 1 — Core PDF engine (2026-07-10)
Shipped (all in `packages/core/src`, exported from `@pdfx/core`):
- `merge.ts` — mergePdfs preserving per-file page order
- `split.ts` — parsePageRanges ("1-3,5,8-10", validated with actionable errors), splitByRange, splitToSinglePages (zip via fflate)
- `pages.ts` — deletePages (refuses to empty a doc), extractPages, reorderPages (permutation-validated)
- `rotate.ts` — rotatePages 90/180/270, per-page or whole-doc, accumulates with existing rotation
- `compress.ts` — Low (lossless object-stream re-save) / Medium (1600px cap, q=0.8) / High (1000px cap, q=0.6); embedded-JPEG re-encode via a platform-injected `ImageReencoder` (`reencode-node.ts` provides the Node/@napi-rs/canvas one; renderer gets an OffscreenCanvas one in Phase 2). Pixel-dimension caps used as the DPI-threshold proxy since placement DPI varies per use.
- `view.ts` — pdf.js render helper (renderPageToCanvas), extractText (per-page), Node standard-font auto-config
- `load.ts` — loadPdf with PdfUserError mapping (password-protected / corrupt)

Tested: 22 unit tests across 7 files, all passing (`pnpm --filter @pdfx/core test`); `tsc --noEmit` clean. Fixtures generated deterministically into `test-fixtures/` (5-page text doc, image-only doc, mixed page sizes; AcroForm fixture generator ready for Phase 4).

Known gaps / deferred:
- Password-protected fixture missing — pdf-lib cannot create encrypted PDFs; will generate via bundled qpdf when it lands (Phase 5/6) and add an open-with-password test then
- Ghostscript High-preset path (desktop) deferred to Phase 5/6 binary bundling
- FlateDecode (PNG-style) embedded images are not re-encoded by compress, only DCTDecode/JPEG — acceptable v1 scope, noted for later

Offline verification: yes — unit tests exercise all Phase 1 functions with zero network access (pure local library calls; ran with Wi-Fi connected but no requests made — pdf-lib/pdf.js/fflate are fully local).

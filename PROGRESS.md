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

## Phase 2 — Desktop UI for core tools (2026-07-10)
Shipped:
- "Prepress/light-table" visual identity (dark graphite desk, paper-white pages, CMYK accent system, crop-mark selection language; Bricolage Grotesque / Inter / IBM Plex Mono, bundled offline via @fontsource)
- Home: drag-and-drop zone + tool cards (every tool ≤2 clicks)
- Workspace: virtualized ThumbnailGrid (IntersectionObserver-driven; only near-viewport pages render), click/ctrl/shift selection, HTML5 drag-reorder with insertion markers, rotate/delete from toolbar + shortcuts
- Single-page Viewer with zoom steps, Ctrl+scroll zoom, page paging (double-click a thumbnail)
- Merge dialog (reorder open docs, merge, save), Split dialog (range → PDF, all pages → zip), Compress menu (3 presets; OffscreenCanvas JPEG re-encoder in the worker)
- All mutations run in a renderer Web Worker (`ops.worker.ts`) — UI thread never blocks; per-doc session undo/redo (snapshot stack, cap 20)
- Native open/save dialogs over contextIsolated IPC; multi-document tabs; unsaved-changes dot (process yellow); status bar with offline badge
- Shortcuts wired per the audited table: Ctrl+O/S/Z/Y, Ctrl+R rotate, Ctrl+D & Delete

Tested:
- 23 unit tests pass incl. new 50-page perf budget: rotate 62ms / delete 50ms / reorder 31ms (budget 1000ms)
- Full UI flow exercised in a browser harness against the real components (dev-only bridge shim): open → select → rotate → delete 5→4 pages → drag-reorder (3,4,5,1) → save (13ms) → reopen saved bytes → changes persisted
- Electron app built and launched; window renders the full workspace
- Fixed en route: React StrictMode double-render race on pdf.js canvases (renders now serialize per canvas), electron-vite main-entry filename mismatch

Known gaps / deferred:
- Browser-pane E2E was flaky due to the test pane running 4 duplicated app instances — proper Playwright-against-Electron E2E lands in Phase 8
- Extract-pages UI and recent-files list not yet wired (core fn exists; UI in a later phase alongside storage spec)
- Shared `packages/ui-components` still empty — components live in apps/desktop for now; extraction deferred until mobile needs them

Offline verification: yes — dev server stopped, app launched from built output with no network; all Phase 2 features are local (pdf.js worker + ops worker bundled, fonts bundled).

## Phase 3 — Editing tools (2026-07-10)
Shipped:
- Core (`packages/core/src/editing/`): addTextItems, addMarkups (highlight/underline/strikethrough), addStrokes (freehand → SVG path), addStamps (image placement, also the future signature pipeline), addPageNumbers (6 position presets + format string), addWatermark (diagonal text/image, opacity), cropPages, and **true redaction** — redactRegions/replacePagesWithImages rasterize the page at 2x, paint the regions black, and replace the entire original page with the bitmap so no content stream survives
- Desktop viewer gained a full edit mode: Text (click-to-place inline inputs), Draw (pointer strokes with live SVG preview), Markup (pdf.js TextLayer + real text selection → rects), Image stamp (drag/resize box), Crop (rubber-band rect, all-pages toggle), Redact (multiple rects, double-click to remove, confirm dialog stating the pages-become-images tradeoff)
- Page numbers + Watermark dialogs on the document toolbar
- All ops run through the worker; redaction rasterizes in the renderer (reusing the pdf.js cache) and replaces pages in the worker

Tested:
- 32 core unit tests pass, including the Phase 3 acceptance test: after redactRegions, extractText finds NOTHING on the redacted page (and untouched pages keep their text)
- Same acceptance re-proven through the real UI: opened doc → drew redact rect over the headline → Apply → confirm → Save → reloaded saved bytes → page 1 text extraction is empty, page 2 intact
- Text tool and watermark also verified end-to-end through the UI (saved bytes contain "UI-ADDED-TEXT" and "CONFIDENTIAL")

Known gaps / deferred:
- Draw color is fixed dark-ink for now (width selectable); color picker later
- Markup selection preview shows a pending count rather than painted rects pre-commit
- Pressure-sensitive stroke width not implemented (pointer `pressure` noted for later)

Offline verification: yes — all editing is pdf-lib/pdf.js local computation; no network calls introduced (CSP still default-src 'self').

## Phase 4 — Forms & signatures (2026-07-10)
Shipped:
- Core `forms/fill.ts`: listFormFields (type, value, page, rect, editability for text/checkbox/radio/dropdown/option-list) and fillFormFields (text + checkbox, regenerates appearances); `forms/create.ts`: createFormFields (text field + checkbox, unique-name enforced)
- Desktop Forms panel: detects and lists every AcroForm field, editable inputs for supported types, unsupported types shown read-only with their type label, Apply batches changes through the worker
- Field tool in the viewer: draw a rectangle → name it → creates a real AcroForm text field/checkbox there
- SignatureDialog (Sign + Initials slots): Draw (pointer pad with ink trimming), Type (bundled Caveat handwriting font → canvas), Upload; last-used image persisted per slot in localStorage (device-local only) with a "Use saved" shortcut; placement reuses the viewer's stamp mode with drag/resize

Tested:
- 37 core unit tests pass (5 new form tests: list/fill/persist-on-reload/create-then-fill/duplicate-name rejection)
- UI end-to-end: filled the AcroForm fixture through the Forms panel, saved, and read the values back with pdf.js's annotation layer (independent viewer engine, same as Firefox's PDF viewer): "Grace Hopper" / "Yes" ✓
- Signature: typed signature in Caveat → placed via stamp mode → applied; "Use saved" persistence path verified; field creation verified (new field shows up in the panel and is fillable)
- Fixed en route: CSP (default-src 'self') blocked fetch(data:) in the signature flow — switched to direct base64 decode

Known gaps / deferred:
- Radio/dropdown editing deferred (guide scopes v1 to text+checkbox); they list as read-only with values
- A real third-party-app check (e.g. opening in Chrome/Adobe) is worth doing manually in Phase 6's packaged-build pass; pdf.js annotation readback is the automated stand-in

Offline verification: yes — forms/signature paths are pure pdf-lib + canvas; signature images never leave localStorage.

## Phase 5 — Conversion & OCR (2026-07-11)
Shipped:
- Core `convert/`: imagesToPdf (fit/A4/Letter), pdfToImages (platform CanvasEncoder; Node impl provided), extractPlainText, ocrPdf (tesseract.js, per-page progress callback, word boxes kept for the Phase 9 searchable-OCR upgrade), officeToPdf (Node-only module — spawns LibreOffice headless, NOT exported from the package index so mobile bundles never see node builtins)
- `scripts/fetch-binaries.mjs`: downloads the gitignored binaries — tesseract `eng.traineddata` (~4MB, always) and LibreOffice 25.8.5.2 (~350MB MSI, extracted via `msiexec /a`, no admin needed) with `--office`; Ghostscript stub with `--gs` (Phase 6)
- Desktop: Home cards "Images → PDF" (native multi-image picker → one page per image → opens as doc) and "Office → PDF" (picker → LibreOffice in main process → opens converted doc); Workspace "Export" menu — Pages → PNG (150dpi, zipped for multipage), Text → .txt, OCR dialog with page-by-page progress bar and save-as-txt
- OCR runs in the Electron main process (tesseract.js + @napi-rs/canvas + local language data); progress streamed to the renderer over IPC

Tested:
- 42 core unit tests pass, incl. OCR acceptance: an image-only "scanned" fixture OCRs to the correct text ("quick brown fox…", "12345") in ~1.5s/page with local traineddata
- Office acceptance: generated a real .docx, converted with the **bundled** LibreOffice (52s cold start, then fast), verified `%PDF-` output and that extracted text contains the document content
- App builds (main/preload/renderer) and boots clean

Known gaps / deferred:
- PDF→image DPI/quality picker: fixed 150dpi PNG in v1 (choice UI later)
- Extra OCR language packs: user-added downloads later per guide; only `eng` bundled
- LibreOffice cold-start (~50s first conversion) — consider a profile pre-warm in Phase 6
- Fixed en route: pdf.js static ESM import broke the CJS Electron main bundle → lazy dynamic import in core view.ts; @napi-rs/canvas hidden from browser bundlers behind a variable-specifier loader

Offline verification: yes — OCR uses local traineddata (no CDN; tesseract.js worker/wasm from node_modules), LibreOffice runs as a local process, image/text exports are pure canvas/pdf.js.

## Phase 6 — Desktop polish & packaging (2026-07-11)
Shipped:
- App icon: code-generated prepress mark (graphite tile, paper sheet with crop marks, CMY ink dots) → `build/icon.ico` (multi-size) + PNGs via `scripts/gen-icon.mjs`; used for window + installer
- Local-only error logging: unhandled main/renderer errors and failed ops append to a dated file under `app.getPath('logs')` (operation/file metadata, never contents; no remote transport)
- Recent files: last 10 stored in `userData/recent.json`, shown as pills on Home, prune-on-open if a file moved (device-local, never synced)
- Extract selected pages → new document tab (toolbar + Ctrl+E)
- `electron-builder.yml`: NSIS Windows installer, `extraResources` bundling tesseract data + LibreOffice (MSI filtered out), asarUnpack for native/worker modules; mac dmg / linux AppImage targets configured
- Bumped desktop to v1.0.0

Tested:
- 43 core unit tests pass, incl. new 500-page perf sanity (rotate 544ms / delete 527ms — no UI-freezing quadratic blowup)
- Packaged the app (electron-builder) and launched the **built** `win-unpacked/PDFX.exe` (not dev) — boots clean, no errors, `resources/resources/{libreoffice/program/soffice.exe, tesseract/eng.traineddata}` present in the packaged tree
- Extract + multi-select verified through the UI (3 selected → 3-page extract in a new tab)
- Installer: `PDFX-Setup-1.0.0.exe` (~490 MB with LibreOffice bundled)

Known gaps / deferred:
- Only Windows installer produced on this machine; mac/linux targets are configured but unbuilt (need those OSes / CI)
- Ghostscript High-preset path still deferred (canvas re-encode handles High for now)
- Installer is too large to commit/upload to GitHub per project constraint — README documents the fetch-binaries + electron-builder build steps instead

Offline verification: yes — packaged app runs with all helper binaries local; no network transport anywhere (logging is file-only, CSP default-src 'self').

## Phase 7 — Mobile app (Android APK) (2026-07-11)
Shipped:
- `apps/mobile`: full React Native 0.86 app on the shared core. New lean core entry `@pdfx/core/mobile` re-exports only the pure `pdf-lib` operations (Phase-1 toolset + watermark + page numbers), so Metro never bundles the DOM/Node-only parts (pdfjs-dist, tesseract.js, @napi-rs/canvas). All PDF work runs in Hermes.
- Tools on-device: open (system doc picker), merge (append a second PDF), split (range → saved to Downloads), delete, extract (→ Downloads), reorder (selected-to-front), rotate, compress, watermark, page numbers; undo/redo (20-deep snapshot stack); save to Downloads via MediaStore.
- File I/O via `react-native-blob-util`; base64<->bytes done by hand (`src/lib/bytes.ts`) to avoid Hermes atob/btoa binary-string issues.
- Prepress UI identity carried over: graphite desk, paper-white page tiles, cyan action / magenta destructive, registration crop-marks as the selection state.
- App icon: the same code-generated PDFX mark, emitted to all Android mipmap densities (+ round variant) by `scripts/gen-icon.mjs`. App id `com.pdfxmobile`, label "PDFX".

Rendering choice (per guide — document it): **deferred rendered page previews.** Neither `react-native-pdf` nor a `pdfjs-dist`-in-WebView layer is used in v1. The page grid shows numbered paper tiles, not rasterized page images. Rationale: RN 0.86 is new-architecture-only (no way to disable it), so every native module compiles C++ codegen through the NDK; keeping the native surface to a single well-worn module (`react-native-blob-util`) was the difference between a reliably-building APK and a fragile one on this Windows + pnpm + new-arch toolchain. Visual thumbnails/rendering are the first v1.1 mobile item.

Tested (Pixel_Fold_API_35 emulator, API 35):
- Debug build (Metro) end-to-end: opened a real 5-page PDF from the picker → grid showed 5 pages (proves blob-util read + pdf-lib parse on Hermes) → selected page 3, Delete → grid showed 4 pages → Save → wrote `pdfx-test-5page (1).pdf` to Downloads via MediaStore. Pulled it back and loaded with pdf-lib on the host: **valid PDF, 4 pages** — the on-device edit produced a correct result.
- Release APK (`app-release.apk`, 18.7 MB, Hermes bytecode, debug-keystore signed): installed with Metro killed and `adb reverse` cleared — launches and renders from its bundled bundle, i.e. fully offline/self-contained.

Toolchain notes (pnpm + RN new arch, resolved en route):
- pnpm's isolated node_modules hides packages RN's Gradle resolves by path — added `@react-native/gradle-plugin`, `@react-native/codegen`, and `hermes-compiler` as direct deps so they symlink where the build expects; pointed `react.hermesCommand` at the `hermes-compiler` package.
- Installed missing SDK bits via fresh cmdline-tools (the bundled `tools/bin/sdkmanager` is dead on JDK 21): build-tools 36, NDK 27.1.12297006, cmake 3.22.1.

Known gaps / deferred:
- No rendered page previews / in-app page viewer (see rendering choice above) — v1.1.
- Editing beyond watermark/page-numbers (text, draw, stamp, signatures), forms, OCR, and conversions are desktop-only in v1 — they need on-screen placement and/or canvas/pdfjs that the numberless-grid mobile shell doesn't yet host.
- Compress medium/high fall back to a lossless re-save on mobile (no canvas image re-encoder); low is identical to desktop.
- APK is signed with the debug keystore (self-signed); fine for sideloading, not Play-Store upload.

Offline verification: yes — release APK runs with no dev server and makes no network calls (INTERNET permission is present only so the *debug* build can reach Metro; the app itself never uses it).

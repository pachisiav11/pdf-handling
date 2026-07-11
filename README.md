# PDFX — offline-first PDF editor

Fast, private, fully-offline PDF editing for desktop and Android, built from one shared TypeScript core. **No uploads, no accounts, no telemetry, no paywall.** Everything runs on your machine — the competitive angle against tools like iLovePDF is that there is no upload/download round-trip and nothing ever leaves your device.

<!-- Screenshots added in Phase 8 -->

## Why it's different from iLovePDF & friends

| | iLovePDF (web) | PDFX |
|---|---|---|
| Where files go | Uploaded to a server | Never leave your machine |
| Works offline | No | Yes — every core tool |
| Speed | Upload → process → download | Instant, local (≤1s on typical docs) |
| Accounts / paywall | Yes for many tools | None |
| Telemetry | Yes | None (errors log to a local file only) |

## Features

**Core** — merge, split (by range or into individual pages), delete/extract/reorder pages, rotate, compress (3 presets), view with zoom.
**Editing** — text overlay, highlight/underline/strikethrough, freehand draw, image stamps, page numbers, watermark, crop, and **true redaction** (the page is rasterized and the original content stream is discarded — the removed text cannot be recovered, unlike a cosmetic black box).
**Forms & signatures** — detect & fill AcroForm fields, create text-field/checkbox fields, and sign or initial by drawing, typing (handwriting font), or uploading an image (saved locally for reuse).
**Conversion** — images ↔ PDF, PDF → images (PNG), PDF → text, OCR of scanned PDFs (Tesseract, English bundled), and **Office → PDF** (Word/Excel/PowerPoint, desktop-only via bundled LibreOffice).

See [PROGRESS.md](PROGRESS.md) for exactly what's implemented per phase.

## Repository layout

```
packages/core        @pdfx/core — all PDF logic (pdf-lib, pdf.js, tesseract.js), shared by both apps
packages/ui-components  shared React components (stub; components currently live in the desktop app)
apps/desktop         Electron + React (electron-vite)
apps/mobile          React Native (Android)
scripts/             fetch-binaries.mjs, gen-icon.mjs
```

## Build & run from source

Requires **Node ≥ 20** and **pnpm 9** (`npm i -g pnpm@9`). pnpm 11 has a linking hang on this workspace on Windows — use 9.x.

```sh
pnpm install

# core unit tests (43 tests, includes redaction & OCR acceptance checks)
pnpm --filter @pdfx/core test

# desktop app in dev
pnpm --filter @pdfx/desktop dev
```

### Desktop production build & installer

```sh
node scripts/fetch-binaries.mjs --office   # download offline binaries first (see below)
pnpm --filter @pdfx/desktop build
cd apps/desktop && npx electron-builder --win   # → apps/desktop/release/PDFX-Setup-<version>.exe
```

## Native binaries (not committed to git)

The large offline helper binaries are **not** stored in this repo (they'd bloat it by well over a gigabyte). Fetch them locally with:

```sh
# Tesseract English OCR data (~4 MB) — always needed for OCR
node scripts/fetch-binaries.mjs

# + LibreOffice (~350 MB download, ~1.6 GB extracted) — needed for Office → PDF
node scripts/fetch-binaries.mjs --office

# + Ghostscript (optional; better High-preset compression)
node scripts/fetch-binaries.mjs --gs
```

They land under `apps/desktop/resources/` (gitignored). electron-builder bundles them into the installer as `extraResources`. **The bundled-LibreOffice installer is ~490 MB** — that's the documented tradeoff for making Office conversion work fully offline. If you skip `--office`, the app falls back to a system-installed LibreOffice if one is present, and clearly reports when conversion is unavailable rather than failing silently.

OCR works with only the small Tesseract step; Office conversion is the only feature that needs the large download.

## Privacy & logging

No network calls in any core tool. Crash/error logging is **local only** — unhandled errors go to a dated log file under the OS log directory (`app.getPath('logs')`), capturing operation type and file metadata but never file contents. There is no remote transport, analytics SDK, or crash reporter.

## License

MIT.

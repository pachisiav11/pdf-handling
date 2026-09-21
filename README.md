# PDFX — PDF editor for desktop and Android

[![CI](https://github.com/pachisiav11/pdf-handling/actions/workflows/ci.yml/badge.svg)](https://github.com/pachisiav11/pdf-handling/actions/workflows/ci.yml)

A fast, keyboard-driven PDF editor for Windows and Android, built from one shared TypeScript core.

> **Your documents are uploaded for processing.** As of the current version, every document
> mutation (merge, split, rotate, compress, watermark, page numbers, image→PDF) is performed by
> the [iLovePDF REST API](https://www.iloveapi.com/). Files are uploaded over HTTPS to iLovePDF's
> servers, processed there, and downloaded back. They are **not** processed on your machine, and
> using the app consumes iLovePDF API credits. Earlier versions of PDFX processed everything
> locally; that is no longer true, and the claims below have been corrected accordingly.

Page rendering, thumbnails, page counts, and view state are still computed locally. Office→PDF
conversion and OCR on the desktop app still run locally via bundled LibreOffice and Tesseract.

**Download:** grab the Windows installer and the Android APK from the [latest release](https://github.com/pachisiav11/pdf-handling/releases/latest).

## Screenshots

Desktop (Electron) — the prepress light-table: graphite desk, paper-white page thumbnails, CMYK ink accents, registration crop-marks as the selection state.

Android — the same identity, running the shared core in Hermes:

| Home | Page grid + tools |
|---|---|
| ![PDFX Android home](docs/screenshots/mobile-home.png) | ![PDFX Android page grid](docs/screenshots/mobile-pages.png) |

## Where your files go

| | PDFX |
|---|---|
| Document processing | iLovePDF REST API, over HTTPS |
| Local-only work | Page rendering, thumbnails, page counts, desktop Office→PDF, desktop OCR |
| Accounts | None in the app; an iLovePDF project key is required to build/run it |
| API credits | Consumed per operation, against the configured iLovePDF project |
| Telemetry | None — errors are written to a local log file only |

## Features

### Working (processed by the iLovePDF API)

Merge, split by range, split into individual pages, delete pages, extract pages, rotate all pages,
compress (3 presets), page numbers, text watermark, images → PDF, and set the document title.

### Working locally

Page rendering, thumbnails and zoom; PDF → images; PDF → text; OCR of scanned PDFs (Tesseract,
English bundled, desktop only); Office → PDF (Word/Excel/PowerPoint, desktop only, via bundled
LibreOffice); session undo/redo; the command palette (Ctrl+K); and batch processing, which now
dispatches each file's operation to the API.

### Not currently available

These shipped in v1.0/v1.1 as local operations and are **disabled** in the current build, because
the iLovePDF API offers no equivalent: page reordering, rotating only selected pages, target-size
compression, page-size normalization, searchable OCR text layers, text overlay, highlight /
underline / strikethrough, freehand drawing, image stamps and signatures, image watermarks,
cropping, redaction, and AcroForm field detection / filling / creation.

**Android** — merge, split, delete, extract, rotate all pages, compress preset, text watermark,
page numbers, title, batch (multi-file → Downloads), a long-press per-page action sheet, undo/redo,
and save to Downloads. Rendered page previews, editing, forms, OCR and conversion are desktop-only.

See [PROGRESS.md](PROGRESS.md) for what was implemented per phase.

## iLovePDF API configuration

The app cannot process anything without an iLovePDF project key pair. The **public** project ID is
committed in the source on purpose; the **private** key must never be committed, bundled, or sent to
a client.

Development (repository root `.env`, gitignored):

```env
ILOVEPDF_PRIVATE_KEY=your-private-key
ILOVEPDF_REGION=in
```

Installed desktop app — create `%APPDATA%\PDFX\iloveapi.json`:

```json
{ "privateKey": "your-private-key" }
```

The Electron main process signs a short-lived HS256 JWT with the private key and exposes only that
token to the renderer over IPC. The Android app never holds the private key; it uses iLovePDF's
public `/v1/auth` flow. Apply IP/domain restrictions in the iLovePDF dashboard where your plan
supports them.

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

### Android app (APK)

Requires the **Android SDK** (platform 36, build-tools 36.0.0), **NDK 27.1.12297006**, **CMake 3.22.1**, and **JDK 21**. RN 0.86 is new-architecture-only, so the NDK/CMake are required even though the app ships no C++ of its own.

```sh
# from a fresh checkout, install workspace deps first
pnpm install

# debug build onto a running emulator/device (Metro required):
pnpm --filter @pdfx/mobile start          # terminal 1 — Metro
pnpm --filter @pdfx/mobile android        # terminal 2 — build + install

# self-contained release APK (bundled JS, no Metro; PDF operations still need network):
cd apps/mobile/android && ./gradlew assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

The prebuilt APK is attached to the [latest release](https://github.com/pachisiav11/pdf-handling/releases/latest) alongside the desktop installer (it is not committed to git). It is signed with the debug keystore — fine for sideloading.

> **pnpm + React Native note:** with pnpm's isolated `node_modules`, RN's Gradle build resolves a few packages by path that would otherwise be hidden in the virtual store. They are declared as direct devDependencies of `@pdfx/mobile` (`@react-native/gradle-plugin`, `@react-native/codegen`, `hermes-compiler`) and `react.hermesCommand` is pointed at the `hermes-compiler` package. This is why the app builds under pnpm without hoisting.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR:
- **verify** (Ubuntu) — install, `@pdfx/core` unit tests, typecheck all three packages, the desktop electron-vite bundle, and the mobile Metro bundle. This is the always-on gate.
- **android-apk** (Ubuntu) — installs the SDK/NDK/CMake and produces the release APK as a build artifact.
- **desktop-installer** (Windows) — builds the NSIS installer (without the large LibreOffice payload; the app degrades to a system LibreOffice) and uploads it as an artifact.

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

# PDFX — offline-first PDF editor

Fast, private, fully offline PDF editing. Desktop (Electron) + Android (React Native) built from a shared TypeScript core (`@pdfx/core`). No uploads, no accounts, no telemetry.

> **Status: under construction.** See [PROGRESS.md](PROGRESS.md) for what works today and [build_guide.md](build_guide.md) for the full spec. A proper README lands in Phase 8.

## Quick start (dev)

```sh
pnpm install
pnpm --filter @pdfx/core test     # core unit tests
pnpm --filter @pdfx/desktop dev   # desktop app
```

## Native binaries (not in git)

Large offline helper binaries (LibreOffice, Tesseract, Ghostscript, qpdf) are **not committed** to this repo. A fetch script + setup instructions will be added when the features that need them ship (Phase 5/6).

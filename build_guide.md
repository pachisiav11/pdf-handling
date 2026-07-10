# Build Prompt: Offline PDF Editor (Desktop + Mobile)

Paste everything below this line into the build agent.

---

## Mission

Build a fast, offline-first PDF editing application that beats iLovePDF.com on speed and usability by doing everything locally with no upload/download round-trip. Ship two clients from a shared codebase:

1. **Desktop app** — Electron (Windows/Mac/Linux)
2. **Mobile app** — React Native (Android APK as the primary target; iOS can follow the same code but is not a requirement for v1)

Both apps must share as much core PDF logic as possible via a shared TypeScript package, since Electron and React Native are both JS/TS runtimes. Do not duplicate PDF manipulation logic between the two apps.

## Non-negotiable requirements

- **Offline-first**: every core tool (merge, split, rotate, compress, edit, annotate, forms, e-signature, image↔PDF, text extraction, OCR) must work with zero network calls. Verify this concretely: run the app with networking disabled (e.g. `iptables` drop / Windows Firewall outbound block / just unplug wifi) at the end of each phase and confirm the phase's features still work. Office-document conversion (Word/Excel/PowerPoint ↔ PDF) is desktop-only and offline via a bundled LibreOffice headless binary — clearly mark this as unavailable on mobile rather than faking it or silently failing.
- **Speed**: prioritize instant feedback.
  - Operations on typical documents (≤50 pages, ≤20MB) must complete in **under 1 second** end-to-end (button press to updated UI), excluding OCR and Office conversion which are inherently slower — those must show a progress indicator with page-by-page or step-by-step status instead of a spinner with no feedback.
  - Page thumbnail rendering must be virtualized (only render thumbnails in/near the viewport) so a 500-page document doesn't stall the UI on open.
  - All PDF parsing/writing/rendering must run off the main/UI thread: Node `worker_threads` in Electron's main process (or a dedicated renderer-side Web Worker for pdf.js rendering), and a background JS context (e.g. a headless RN screen / InteractionManager-deferred work, or a native module if a pure-JS approach proves too slow) in React Native. The UI must never freeze during a multi-page operation.
  - App cold-start to interactive: under 2 seconds on desktop, under 3 seconds on a mid-range Android device.
- **Easy-to-use UI**: drag-and-drop file input, page thumbnail grid for reordering/deleting/rotating, a persistent "undo" for destructive operations before final save, and no more than 2 clicks/taps to reach any core tool from the home screen.
- **No telemetry/tracking, no forced accounts, no paywall gates on the core tool list below** — this is the whole competitive angle against iLovePDF. No analytics SDKs (no Sentry-with-network, no Google Analytics, no crash reporters that phone home). Crash/error logging must be local-only (see Error handling & logging below).

## Full tool list (v1 — build all of these, this is not a wish list)

For every tool below: implement it, wire it into a real UI element reachable from the home screen or a document's toolbar, and manually exercise it before marking the phase done.

### Core

| Tool | Library/approach | Notes |
|---|---|---|
| Merge multiple PDFs | `pdf-lib`: `PDFDocument.create()` + `copyPages()` per source doc | Preserve original page order per file; let user reorder files before merging via drag handles |
| Split by page range | `pdf-lib`: `copyPages(srcDoc, [indices])` into a new `PDFDocument` | Accept ranges like `1-3,5,8-10`; validate range against actual page count and show inline error, don't crash |
| Split into individual pages | Same as above, one output file per page | Output as a zip (use `fflate` or similar pure-JS zip lib, offline) so the user gets one download instead of N separate save dialogs |
| Delete / extract / reorder pages | `pdf-lib`: `removePage()`, `copyPages()`, array reorder then rebuild via `copyPages(doc, newOrder)` | Drive from the shared thumbnail grid component (see UI section) |
| Rotate pages | `pdf-lib`: `page.setRotation(degrees(n))` | Support 90/180/270, per-page or whole-document |
| Compress | See "Compression algorithm" below | |
| View + zoom/scroll | `pdf.js` (`pdfjs-dist`) rendering to `<canvas>` | Virtualized page list, pinch-to-zoom on mobile, ctrl+scroll zoom on desktop |

### Editing

| Tool | Library/approach | Notes |
|---|---|---|
| Add/edit text overlay | Custom: absolutely-positioned editable `<div>`/text layer over the pdf.js canvas during edit mode, committed to the PDF via `pdf-lib` `page.drawText()` on save | Font must be embeddable (bundle a couple of standard fonts, e.g. Helvetica via pdf-lib's StandardFonts, plus one embeddable TTF for broader glyph support) |
| Highlight/underline/strikethrough | `pdf-lib`: draw semi-transparent rects (highlight) or thin rects/lines (underline/strikethrough) at the text-layer-selected coordinates from pdf.js's text layer | Reuse pdf.js's text selection API to get accurate bounding boxes, don't hand-roll text hit-testing |
| Freehand draw | Canvas pointer-events capturing a stroke path, converted to an SVG path or a sequence of `pdf-lib` `drawLine()` segments on save | Support pressure/width if available (pointer events `pressure`), otherwise fixed width with a size picker |
| Add images/stamps | `pdf-lib`: `embedPng`/`embedJpg` + `drawImage()` | Let user resize/reposition via drag handles before committing |
| Add page numbers | `pdf-lib`: `drawText()` per page with a position preset (bottom-center/bottom-right/etc.) and a format string (`Page {n} of {total}`) | |
| Add watermark | `pdf-lib`: `drawText()` or `drawImage()` at low opacity, rotated (typical diagonal watermark), applied to all pages | Support both text and image watermarks |
| Crop pages | `pdf-lib`: `page.setCropBox(x, y, width, height)` | Provide a draggable crop-rectangle UI over the rendered page preview |
| Redact | See "Redaction algorithm" below — **must** remove underlying content, not just draw an opaque box on top | This is a correctness-critical feature; get it reviewed/tested explicitly before calling Phase 3 done |

### Forms & signatures

| Tool | Library/approach | Notes |
|---|---|---|
| Fill form fields | `pdf-lib`: `PDFDocument.getForm()`, `form.getTextField()/getCheckBox()/etc()`, `.setText()/.check()` | Detect and list all fields on load; unsupported field types should show as read-only with a clear label rather than silently dropping them |
| Create simple form fields | `pdf-lib`: `form.createTextField()`, `createCheckBox()`, positioned via `addToPage()` | v1 scope: text field and checkbox only; dropdowns/radio groups are a later add if time allows |
| E-signature (draw/type/upload) | Draw: canvas capture → PNG. Type: render a cursive/handwriting web font (bundle one, e.g. "Caveat" or similar offline-licensed font) to canvas → PNG. Upload: user-provided image file. Place via `embedPng` + `drawImage()` | Store the user's last-used signature locally (see local storage section) so they don't redraw it every time |
| Initials placement | Same pipeline as signature, smaller default size, separate saved-initials slot | |

### Conversion

| Tool | Library/approach | Notes |
|---|---|---|
| Image (JPG/PNG) → PDF | `pdf-lib`: `embedJpg`/`embedPng` onto a new page sized to the image (or a standard page size, user's choice) | Support multi-image → multi-page PDF in one operation |
| PDF → image | `pdf.js` render to canvas → `canvas.toBlob()` per page | Export as PNG or JPG, user choice of DPI/quality |
| PDF → text extraction | `pdf.js` `getTextContent()` per page | Preserve reading order as best pdf.js provides; export as plain `.txt` |
| Word/Excel/PowerPoint ↔ PDF | Bundled LibreOffice headless: `soffice --headless --convert-to pdf <file>` (and reverse direction is **not** reliable with LibreOffice — see note) | **Desktop only.** Bundle the LibreOffice binary with the Electron app (increases installer size significantly — document this tradeoff in the README). PDF→Office (reverse direction) is low-fidelity with any offline tool; scope v1 to Office→PDF only, and treat PDF→Office as a stretch/explicitly-labeled "best effort" feature if attempted at all. |
| OCR for scanned PDFs | `tesseract.js` (shared core, works in both apps) for portability; optionally shell out to a bundled native `tesseract` binary on desktop for speed if `tesseract.js` proves too slow on large scans | Language pack: bundle English (`eng.traineddata`) by default; make additional language packs optional downloads the user can add later (still offline once downloaded — do not silently fetch them without the user initiating it) |

## Good-to-have features (v1.1 scope — build in Phase 9, after v1.0, do not let these block the v1 tool list above)

- **Target-size compression** — see "Compression algorithm" below for the exact binary-search approach.
- **Multi-file batch processing** — user selects N files, picks one operation + its settings once, app applies it to all N with a per-file progress list (queued/running/done/failed) and a summary at the end (e.g. "8 succeeded, 1 failed: corrupt file X"). Distinct from merge (which combines files into one output). Must use a bounded worker pool (see "Batch processing architecture" below), not fire-all-at-once.
- **Page size normalize** — a tool (standalone, and offered as a checkbox during merge) that rescales every page to a uniform target size (A4 or Letter, user's choice) by scaling content via `pdf-lib`'s page `scale()`/embedding pages into a new fixed-size page and centering.
- **Metadata editor (title only for v1.1)** — `pdf-lib`: `doc.setTitle(str)`. A single text field in a "Document Properties" panel. Do not build out author/subject/keywords/producer editing in v1.1.
- **Searchable OCR** — upgrade Phase 5's OCR so `tesseract.js`'s word-level bounding-box output is used to place invisible (render-mode-3, i.e. `Tr 3` in PDF content stream terms — `pdf-lib` supports invisible text via `opacity: 0` text draw) text directly over the corresponding image regions via `pdf-lib` `drawText()`, so the result is selectable/searchable/copyable while looking unchanged.
- **Command palette + shortcuts** — see "Keyboard shortcuts" table below for the exact, collision-checked bindings to implement. Desktop-first (Electron `globalShortcut`/renderer `keydown` handling); on mobile, the equivalent is a long-press context/action sheet, not a keyboard palette.
- **Full session undo/redo** — see "Undo/redo architecture" below for the command-pattern design to implement.

Explicitly descoped for now (do not build, revisit later only if the user asks): full metadata editor beyond title, bookmark/TOC editor, PDF comparison/diff, digital signature verification, granular permission sets, PII redaction assist, local encrypted vault, split-by-max-file-size, CLI companion, booklet/N-up print layouts.

## Detailed algorithm specs

### Compression algorithm (v1 fixed presets, v1.1 target-size)

v1 (Phase 1): three presets — Low/Medium/High compression — implemented as: (1) re-save through `pdf-lib` with object-stream compression enabled (`doc.save({ useObjectStreams: true })`) as a free first pass, then (2) for Medium/High, downsample embedded raster images above a DPI threshold (e.g. re-encode images above 150/300 DPI-equivalent down to a target DPI using a canvas re-encode: draw the image at reduced pixel dimensions, re-export as JPEG at a quality level tied to the preset — Low: no image touch, Medium: 150 DPI cap / JPEG q=0.8, High: 100 DPI cap / JPEG q=0.6). On desktop, if Ghostscript is bundled, prefer shelling out to it for the High preset since it materially outperforms a hand-rolled pass (`gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook ...`).

v1.1: target-size mode does a **binary search over a single "quality knob"** (0.0–1.0, mapped internally to JPEG quality + DPI cap) — compress at quality 0.5, check output size, if too big search [0.0, 0.5], if under target search [0.5, 1.0] to get as close to target without going over, cap at ~6 iterations to bound latency, and if even quality 0.0 (max compression) doesn't hit the target, tell the user plainly ("Can't reach 2MB — smallest possible is 4.1MB") instead of returning an oversized file silently.

### Redaction algorithm

Redaction must remove the underlying content, not draw over it. Approach: (1) user draws a rectangle over the region to redact on the rendered page preview; (2) rasterize that page via `pdf.js` to a canvas at a resolution matching or exceeding the original (e.g. 2x for quality); (3) paint an opaque black rectangle onto the canvas at the selected region; (4) replace the *entire page* in the output `pdf-lib` document with the rasterized image (embed the modified canvas as a JPEG/PNG and place it as a full-page image on a page of the same dimensions), discarding the original vector/text content stream for that page entirely. This guarantees no residual text/vector data survives under the black box, at the cost of that page becoming a raster image (larger file size, no longer text-selectable) — document this tradeoff to the user in the UI ("Redacted pages become images and are no longer searchable") before they confirm.

### Undo/redo architecture

Command pattern: every mutating operation (rotate, delete page, add text, draw stroke, apply watermark, etc.) is represented as a serializable `{ type, params, inverse }` object pushed onto an in-memory stack (`packages/core/src/history.ts`). `inverse` either stores enough data to reverse the op directly (e.g. delete-page's inverse re-inserts the removed page at its original index — keep the removed page's bytes in memory for the session) or, where a true inverse is impractical (e.g. after a compress), the stack instead snapshots the full document bytes before the op (acceptable since compress/OCR are terminal-ish operations users are unlikely to want to step past). Cap the in-memory history (e.g. last 50 operations or a memory budget like 200MB of snapshots) and drop the oldest when exceeded, rather than growing unbounded. Undo/redo state resets when a document is closed — this is a session-scoped feature, not a persistent edit history.

### Batch processing architecture

A worker pool bounded to `min(4, os.cpus().length)` concurrent jobs (desktop) — do not spawn one worker thread per file for large batches, queue instead. Each job reports `queued → running → done | failed(reason)` to a UI list; failures in one file must not abort the batch. On mobile, bound concurrency more conservatively (e.g. 2) given weaker hardware and to keep the UI responsive.

## Keyboard shortcuts (desktop — audited against Windows/Electron defaults to avoid collisions)

Do not reassign anything in the left column; these are reserved by the OS/Electron and must keep their standard meaning:

| Reserved (do not touch) | Meaning |
|---|---|
| Ctrl+S | Save |
| Ctrl+O | Open |
| Ctrl+W | Close tab/window |
| Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) | Undo / Redo |
| Ctrl+F | Find |
| Ctrl+N | New |
| Alt+F4 | Quit (Windows) |
| Ctrl+Tab / Ctrl+Shift+Tab | Switch document tabs, if a tabbed interface is used |

App-specific shortcuts (chosen to avoid the above and common browser/OS bindings):

| Shortcut | Action |
|---|---|
| Ctrl+K | Open command palette |
| Ctrl+M | Merge — open merge dialog with current selection |
| Ctrl+Shift+S | Split |
| Ctrl+R | Rotate selected page(s) 90° clockwise |
| Ctrl+D | Delete selected page(s) |
| Ctrl+E | Extract selected page(s) to new document |
| Ctrl+Shift+W | Add watermark |
| Ctrl+Shift+C | Compress |
| Ctrl+Shift+R | Redact mode toggle |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset (matches common convention, does not collide with anything above) |
| Delete | Delete selected page(s) in thumbnail grid (in addition to Ctrl+D) |
| Escape | Cancel current tool/exit edit mode |

Every shortcut must be shown next to its menu item and inside the command palette results — never something the user has to memorize from docs alone. Before adding any new shortcut beyond this table in a later phase, check it against both tables above for collisions.

## Suggested architecture

Monorepo, package manager `pnpm` with workspaces (Turborepo optional, add only if build times actually become a pain — don't add it speculatively).

```
pdf-handling/
  package.json                 # workspace root, private:true, workspaces: ["packages/*", "apps/*"]
  pnpm-workspace.yaml
  tsconfig.base.json            # shared compiler options, path aliases (@pdfx/core, @pdfx/ui)
  .eslintrc.cjs / .prettierrc   # shared lint/format config, referenced by each package
  PROGRESS.md                   # phase tracker, updated at the end of every phase before pushing
  build_guide.md                # this file
  README.md                     # written properly in Phase 8

  packages/
    core/
      src/
        merge.ts split.ts pages.ts rotate.ts compress.ts view.ts   # core tool implementations
        editing/ (text.ts highlight.ts draw.ts stamp.ts pageNumbers.ts watermark.ts crop.ts redact.ts)
        forms/ (fill.ts create.ts signature.ts)
        convert/ (imageToPdf.ts pdfToImage.ts textExtract.ts officeConvert.ts ocr.ts)
        history.ts             # undo/redo command stack (see algorithm spec above)
        batch.ts                # worker-pool batch runner (see algorithm spec above)
        types.ts                # shared types: PdfDocumentHandle, PageRef, EditCommand, etc.
      test-fixtures/            # sample PDFs (a text doc, a scanned/image-only doc, a form doc, a multi-page doc)
      test/                     # unit tests, one file per src module
      package.json

    ui-components/
      src/ (ThumbnailGrid.tsx Toolbar.tsx CommandPalette.tsx SignaturePad.tsx CropOverlay.tsx ...)
      package.json              # React components; shared between Electron renderer and RN only where
                                 # react-native-web makes sense — otherwise keep API-compatible but separate
                                 # implementations per platform rather than forcing an awkward abstraction

  apps/
    desktop/
      electron/ (main.ts preload.ts ipc/*.ts)   # main process: file dialogs, worker_threads dispatch, IPC
      src/                                        # renderer: React app, imports @pdfx/core and @pdfx/ui
      resources/ (bundled soffice, tesseract binary + eng.traineddata, ghostscript)
      electron-builder.yml
      package.json

    mobile/
      android/                  # native Android project (Gradle)
      src/                      # React Native app, imports @pdfx/core
      package.json
```

Core library choices and exact packages:
- `pdf-lib` — create/merge/split/rotate/reorder/watermark/page numbers/basic form fields/encryption
- `pdfjs-dist` — rendering pages to canvas for the viewer, redaction rasterization, text-layer selection for highlight/underline/strikethrough, text extraction
- `tesseract.js` — OCR, works in both Electron and React Native
- `fflate` — pure-JS zip creation (for "split into individual pages" multi-file export)
- `qpdf` (desktop, bundled binary) — repair, encrypt/decrypt edge cases pdf-lib can't handle
- `ghostscript` (desktop, bundled binary) — heavy compression pdf-lib/canvas re-encoding can't match as well
- LibreOffice headless (desktop, bundled) — Office format conversion
- On mobile, skip Ghostscript/qpdf/LibreOffice (no native binary bundling story there) — implement compression via the pdf-lib + canvas re-encode path only, and clearly gate Office conversion as "desktop only" in the mobile UI (grey out the option with a tooltip/explainer, don't just hide it silently).

## Data model (packages/core/src/types.ts — implement these shapes)

```ts
interface PdfDocumentHandle {
  id: string;              // uuid, session-scoped
  fileName: string;
  bytes: Uint8Array;       // current working bytes
  pageCount: number;
  sourcePath?: string;     // undefined if not yet saved / opened from a picker without a stable path
}

interface PageRef {
  docId: string;
  index: number;           // 0-based, current position
  rotation: 0 | 90 | 180 | 270;
  originalIndex: number;   // for undo bookkeeping
}

interface EditCommand {
  id: string;
  type: 'rotate' | 'delete-page' | 'reorder' | 'add-text' | 'draw' | 'watermark' | 'crop' | 'redact' | 'compress' | '...';
  params: Record<string, unknown>;
  inverse:
    | { kind: 'direct'; params: Record<string, unknown> }   // reversible via a direct inverse op
    | { kind: 'snapshot'; bytesBefore: Uint8Array };          // full-document snapshot fallback
  timestamp: number;
}
```

Keep these as the actual contract between `core` and both UI layers — don't let the Electron and React Native apps invent their own parallel shapes.

## Local storage / session persistence

- Recently opened files list: store file paths + last-opened timestamp in a small local JSON file (Electron: `app.getPath('userData')/recent.json`; RN: `AsyncStorage`). No cloud sync.
- Saved signature/initials images: same local-storage pattern, stored as base64 PNG or a file in the app's data directory.
- Command palette recent/frequent commands: local JSON, used to sort palette results by recency/frequency.
- Nothing here should ever leave the device.

## Error handling & logging

- No network-based crash reporting (rules out default Sentry, Bugsnag, etc. unless self-hosted and explicitly offline-disabled — simplest is to just not include one).
- Local rotating log file (Electron: `app.getPath('logs')`, e.g. via `electron-log` configured with **no** remote transport; RN: a simple local file logger) capturing unhandled errors and failed operations with enough context (operation type, file size, page count — not file contents) to debug from a bug report the user pastes in.
- Every destructive/irreversible action (redact, permanent delete before save, overwrite-on-save) needs a confirmation step or must go through the undo stack before being flushed to disk.
- User-facing errors must be actionable ("This PDF is password-protected — enter the password to continue" / "Page range 5-12 is invalid, this document has 8 pages"), never a raw stack trace in the main UI (raw errors go to the log file only, surfaced via a "Show details" expandable if you want one).

## Testing strategy

- **Unit tests** (`packages/core`): Vitest or Jest, one test file per core module, run against `test-fixtures/`. Every tool in the v1 list needs at least one passing test exercising it end-to-end (input bytes → operation → assert on output: page count, dimensions, presence of expected text/rotation, etc.), not just a type-check.
- **E2E / integration**: Playwright for the Electron app (it supports Electron directly) covering the critical path per phase (e.g. Phase 2: open file → reorder pages → delete a page → save → reopen and verify). Detox or Maestro for the React Native app once Phase 7 starts.
- Test fixtures needed in `packages/core/test-fixtures/`: a plain multi-page text PDF, a scanned/image-only PDF (for OCR/compress tests), a PDF with AcroForm fields, a password-protected PDF, a PDF with mismatched page sizes (for the normalize test).
- Do not mark a phase complete based on `tsc` passing alone — actually run the app and click through the feature, per the workflow rules below.

## UI/visual design requirement

Whenever building or revising UI (component styling, layout, theming, empty/loading/error states) or designing the app logo/icon (for both the Electron app icon and the Android launcher icon/APK), invoke the `/frontend-design` skill first to get aesthetic direction before writing the styling — don't default to generic/templated Material-UI-looking output. Apply this from Phase 2 onward (first real UI work) and specifically when designing the logo in whichever phase that happens (Phase 6 packaging for desktop icon, Phase 7 for the Android launcher icon — reuse the same logo/mark across both, don't design two unrelated icons).

## Workflow rules for this build

1. Work through the phases below **in order**. Do not skip ahead or combine phases.
2. At the end of each phase: make sure the app builds and the phase's features actually run (launch the app, exercise the feature manually, don't rely on compile success alone), run the relevant unit/e2e tests, update `PROGRESS.md` (template below) with what shipped, commit, and push to GitHub.
3. **GitHub target**: create a new **public** repository named `pdf-handling` under the user's GitHub account (`gh repo create pdf-handling --public --source=. --remote=origin`) during Phase 0, and push every subsequent phase to it on `main` (or short-lived feature branches merged to `main` — your call, but `main` must always be in a working state at the end of a phase). Branch naming if used: `phase-N-short-description`.
4. **Fully autonomous**: after pushing a phase, immediately start the next phase without waiting for review. Do not stop to ask for confirmation between phases. Only stop if genuinely blocked (e.g., missing credentials, a decision that changes architecture, or a failure you can't self-resolve after reasonable debugging).
5. Commit message convention: `phase(N): short imperative summary` for phase-completion commits (e.g. `phase(2): wire up thumbnail grid, reorder/delete/rotate in desktop UI`), and normal conventional-ish messages (`fix:`, `feat:`, `chore:`) for intermediate commits within a phase if you choose to commit incrementally.
6. Keep desktop and mobile in sync feature-wise where practical, but it's fine for desktop to lead since it's architecturally simpler (no native mobile build toolchain, no Office conversion parity needed on mobile).
7. `PROGRESS.md` template — append one section per phase, don't rewrite prior entries:
   ```markdown
   ## Phase N — <title> (YYYY-MM-DD)
   Shipped: <bullet list of what actually works now>
   Tested: <what you manually verified + which automated tests run>
   Known gaps / deferred: <anything not fully done, moved to a later phase, or descoped>
   Offline verification: <confirmed with networking disabled: yes/no + how>
   ```

## Phases

**Phase 0 — Scaffolding**
Set up the monorepo exactly per the folder structure above (`pnpm-workspace.yaml`, `tsconfig.base.json`, shared lint/format config). `apps/desktop`: Electron + React skeleton with a blank window and a working native file-open dialog (proves the IPC bridge works). `apps/mobile`: React Native (bare workflow, not Expo managed) skeleton with a blank screen and a working native file picker. `packages/core`: empty package wired into both apps' bundlers to prove the shared-package import path works end-to-end (e.g. export a trivial `ping()` function and call it from both apps). Create the GitHub repo and push.
*Acceptance:* both apps launch, both can import from `@pdfx/core`, desktop can open a file picker, mobile can open a file picker, repo exists on GitHub with this initial commit.

**Phase 1 — Core PDF engine (shared)**
Implement in `packages/core`: merge, split (by range and into individual pages), delete/extract/reorder pages, rotate, compress (v1 fixed presets per the algorithm spec), and a `pdfjs-dist`-based render/view helper (render a given page index to a canvas/ImageBitmap at a given scale). Add `test-fixtures/` and unit tests per the testing strategy — every function needs a passing test.
*Acceptance:* `pnpm test` passes in `packages/core`; each function demonstrably works against a real fixture PDF (not just type-checks).

**Phase 2 — Desktop UI for core tools**
Wire up the Electron app: drag-and-drop file input, `ThumbnailGrid` component (virtualized) with reorder (drag handles)/delete/rotate driven by the Phase 1 core functions, a save/export flow (native save dialog), and the pdf.js-based viewer with zoom/scroll. This is the first "usable" milestone — it should already beat iLovePDF for the core tools in speed since there's no upload. Move heavy operations to `worker_threads` per the performance requirements now, not later.
*Acceptance:* open a real multi-page PDF, reorder/delete/rotate pages via the UI, save, reopen the saved file and confirm the changes persisted. Time the save operation on a 50-page doc and confirm it's under 1s.

**Phase 3 — Editing tools**
Add text overlay editing, highlight/underline/strikethrough (via pdf.js text-layer selection), freehand draw, image/stamp placement, page numbers, watermark, crop, and redaction (per the redaction algorithm spec — full page rasterization, not a cosmetic overlay). Build this on the desktop app first.
*Acceptance:* for redaction specifically — after redacting, extract text from the output PDF (via the Phase 1 text-extraction path) and confirm the redacted content does **not** appear anywhere in the extracted text. This is the concrete test that proves it's a real redaction, not a cosmetic box.

**Phase 4 — Forms & signatures**
AcroForm field detection/filling and simple field creation (text field, checkbox), e-signature capture (draw/type/upload) and placement, initials placement, with last-used signature/initials persisted locally per the storage spec. Desktop app.
*Acceptance:* fill and save a real AcroForm-bearing PDF, reopen it in this app and in a third-party viewer (e.g. a browser) to confirm the field values actually persisted in a standards-compliant way, not just in-app state.

**Phase 5 — Conversion**
Image↔PDF, PDF→text extraction, OCR via Tesseract (English pack bundled), and Office→PDF via bundled LibreOffice headless (desktop only, Office→PDF direction only per the conversion table note). Wire all into the desktop UI, with Office conversion clearly greyed out/labeled unavailable in any shared UI code path that mobile will later reuse.
*Acceptance:* OCR a real scanned/image-only PDF and confirm extracted text is roughly correct on a known sample; convert a real .docx to PDF via the bundled LibreOffice and confirm formatting is reasonably preserved.

**Phase 6 — Desktop polish & packaging**
Performance pass (profile large-file handling — e.g. a 500-page or 100MB fixture — confirm no UI freeze, confirm worker-thread offload is actually happening), UI polish pass (consistent spacing/typography, empty states, loading states, error states per the error-handling spec), and `electron-builder` configuration to produce installable Windows (.exe/NSIS), Mac (.dmg), and Linux (.AppImage or .deb) binaries, with the LibreOffice/tesseract/ghostscript binaries correctly bundled as `extraResources` (not left as an external dependency the user has to install separately). Tag a desktop `v1.0` release on GitHub with built artifacts attached.
*Acceptance:* install the packaged app from a clean build output (not `pnpm dev`) on at least the primary dev OS, confirm every v1 tool works from the installed build, confirm no missing-binary errors for LibreOffice/tesseract/ghostscript.

**Phase 7 — Mobile app**
Port the shared-core-backed feature set to `apps/mobile`: all of Phase 1's core tools at minimum, then as much of editing/forms/signatures/conversion (minus Office conversion, minus anything that genuinely requires a bundled native binary unavailable on Android) as is practical on React Native. Use `react-native-pdf` or a `pdfjs-dist`-in-WebView approach for rendering (pick one, document the choice and why in `PROGRESS.md`). Set up the Android build (Gradle, proper package name/app ID, an actual app icon — not the RN default) and produce a signed or debug APK as a GitHub release artifact.
*Acceptance:* install the APK on a real device or emulator, open a PDF, exercise merge/split/rotate/delete/reorder/compress end-to-end on-device, confirm results.

**Phase 8 — Testing, CI, and v1.0**
Add a GitHub Actions workflow that builds both apps on push (lint + typecheck + `packages/core` unit tests, and a build-artifact smoke test — at minimum confirm the Electron build produces an installer and the RN build produces an APK without erroring). Write a real `README.md`: what it does, how it's different from iLovePDF (offline, no upload, no paywall), how to build/run each app from source, and screenshots of the desktop app. Cut a combined `v1.0` GitHub release referencing both platform artifacts.
*Acceptance:* CI is green on a fresh push; README accurately describes the current state (no aspirational claims about unfinished features).

**Phase 9 — Good-to-have enhancements (v1.1)**
Implement the "Good-to-have features (v1.1 scope)" list above, per their detailed algorithm specs: target-size compression (binary search), multi-file batch processing (bounded worker pool), page size normalize, title-only metadata editor, searchable OCR upgrade (invisible text layer), command palette + shortcuts (exact bindings from the table above), and full session undo/redo (command-pattern stack). Ship to both desktop and mobile where the feature makes sense (batch processing and target-size compression apply to both; command palette is desktop-first, mobile gets a long-press action-sheet equivalent). Tag a `v1.1` release when done.
*Acceptance:* target-size compression gets within a reasonable margin of a requested size on a real large PDF or clearly reports it can't; batch processing handles a batch with one deliberately-corrupt file without aborting the rest; undo/redo correctly steps back through a real multi-op sequence (rotate → delete → watermark → undo x3 returns to original).

## After Phase 9

Report back with a summary of what was built, the repo URL, what's genuinely offline vs. what has a documented desktop-only limitation, and any features from the tool list that ended up incomplete or lower quality than intended — don't claim completeness that isn't there.

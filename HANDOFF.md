# PDFX iLovePDF API migration handoff

Last updated: 2026-07-17

> **Historical (2026-09-21).** The iLovePDF migration was reverted in v1.2: both apps process every
> document locally again, and `packages/ilovepdf-api` is kept but unused. Nothing below describes
> the current app. The private-key warning still applies to the ignored `.env` file — revoke the
> key in the iLovePDF dashboard if it is no longer needed.

> **Superseded in part (2026-09-07).** A bug-fix pass has since landed: the renderer CSP, the
> missing workspace alias/link, the lockfile, the module-scope crash, and the API protocol errors
> are fixed; unsupported operations are disabled in both UIs; the client has 24 mocked-fetch tests;
> and the docs no longer claim offline processing. See the last section of `PROGRESS.md` for what
> changed and `todo.md` for what is still open. The "Still requiring migration/removal",
> "Verification status", and "Required next steps" sections below are stale — read them as the
> state before that pass.

## Goal

Replace local PDF mutation with iLovePDF REST API processing across the Electron desktop app and Android app; package/install Electron, produce an APK, push all changes, then complete a project-wide review and push any fixes.

## Credentials and security

The iLovePDF public project ID is intentionally embedded in clients:

```text
project_public_3e6ebf6c7fe3800ecb67d9305ac66106_5TVOU661190bc6af1630f8f86d5ae8d465313
```

The private key was supplied by the user in the ignored repository-root `.env` file. Do not read, print, commit, package, or copy its value.

Development desktop configuration:

```env
ILOVEPDF_PRIVATE_KEY=...
ILOVEPDF_REGION=in
```

Installed desktop configuration (must be created after installation):

`%APPDATA%\PDFX\iloveapi.json`

```json
{ "privateKey": "..." }
```

The Electron main process signs an HS256 JWT with the private key and exposes only the short-lived token to the renderer through a narrow IPC method. The Android app must never contain the private key; it uses the documented iLovePDF public `/v1/auth` flow. The iLovePDF dashboard should apply IP/domain restrictions where the selected plan supports them.

## Current repository state

Branch: `main` tracking `origin/main`.

Base commit: `d7b5ba9a07668da2d079cb3efe7e140d70b058a0` (`origin/main`).

Pre-existing user modification, preserved and unrelated:

- `apps/mobile/android/gradle.properties`

Migration changes currently made (uncommitted):

- Added `packages/ilovepdf-api/`, a dependency-free, cross-platform REST client.
  - Authenticates with an injected token provider or public `/v1/auth`.
  - Runs iLovePDF’s start → upload → process → download workflow.
  - Handles JSON API errors and returns downloaded bytes.
- Added `@pdfx/ilovepdf-api` workspace dependency declarations to desktop and mobile package manifests.
- Added TypeScript path mapping for `@pdfx/ilovepdf-api`.
- Replaced the desktop renderer’s `opsClient.ts` worker RPC implementation with iLovePDF API calls for supported operations.
- Added secure Electron main-process JWT generation and `ilovepdf:token` IPC endpoint.
- Added the preload `apiToken()` bridge.
- Started mobile API migration with `apps/mobile/src/lib/operations.ts`; its store imports cloud operation functions.

## New API client

Files:

- `packages/ilovepdf-api/src/index.ts`
- `packages/ilovepdf-api/package.json`
- `packages/ilovepdf-api/tsconfig.json`

`ILovePdfClient.process(tool, files, parameters)` does:

1. Obtain Bearer token.
2. `POST https://api.ilovepdf.com/v1/start/{tool}/{region}`.
3. Upload each file as multipart form data to the assigned server.
4. Send JSON process request with uploaded server file names.
5. Download completed output bytes.

The client currently supports API tool names: `compress`, `extract`, `imagepdf`, `merge`, `officepdf`, `pagenumber`, `pdfjpg`, `pdfocr`, `rotate`, `split`, and `watermark`.

## Desktop migration details

### Already routed to iLovePDF

`apps/desktop/src/pdf/opsClient.ts` currently maps:

- Merge → `merge`
- Range split → `split` ranges
- Split each page → `split` fixed range
- Delete pages → `split` remove pages
- Extract selected pages → `split` ranges with `merge_after`
- Rotate every page → `rotate`
- Compress presets → `compress` (`low`, `recommended`, `extreme`)
- Set title → `rotate` with `meta.Title`
- Page numbers → `pagenumber`
- Text watermark → `watermark`
- Images to PDF → `imagepdf`

### Explicitly unsupported now

These formerly local functions currently reject with an explanatory error, rather than mutate locally:

- Arbitrary page reordering
- Rotate only selected pages
- Target-size compression
- Page-size normalization
- Searchable text-layer creation from local OCR results
- Text/markup/freehand/image edits
- Image watermarks (text watermark works)
- Crop, redaction, form list/fill/create

This is intentional until each feature is redesigned using an available iLovePDF API tool. Do not restore local `@pdfx/core` mutation calls just to retain an old UI feature; that violates the API-only goal.

### Still requiring migration/removal

The following source paths still invoke local processing and must be replaced, removed, or clearly disabled before claiming API-only behavior:

- `apps/desktop/src/pdf/ops.worker.ts` — obsolete local worker; no longer used by the new ops client and should be deleted after confirming no imports.
- `apps/desktop/electron/main.ts` — still contains local LibreOffice Office conversion and local Tesseract OCR IPC handlers/imports. Replace with file-picker-only IPC and renderer calls to iLovePDF `officepdf` / `pdfocr`, or remove these UI entries until implemented.
- `apps/desktop/electron/preload.ts` — still exports legacy `convertOffice`, `runOcr`, and OCR progress methods; align with migrated flows.
- `apps/desktop/src/lib/convert.ts` — still locally renders PDF pages, zips images, extracts text with core, and calls local OCR. Replace export flows with API tools (`pdfjpg`, `extract`, `pdfocr`) and save iLovePDF output.
- `apps/desktop/src/components/ExportTools.tsx` — assumes page-by-page local OCR result and local searchable-layer writing; redesign to open/download iLovePDF OCR PDF output.
- `apps/desktop/src/components/Viewer.tsx`, `FormsPanel.tsx`, `SignatureDialog.tsx`, and editing dialog flows — hide/disable controls not backed by iLovePDF before release.
- Desktop UI copy still describes the app as offline. Update all messaging to explain that documents are uploaded to iLovePDF for processing.

## Mobile migration details

### Already routed to iLovePDF

`apps/mobile/src/lib/operations.ts` implements iLovePDF calls for:

- Merge
- Split range
- Delete pages
- Extract pages
- Rotate every page
- Compress preset
- Text watermark
- Page numbers
- Title metadata

`apps/mobile/src/state/store.ts` imports these functions for its active operations.

### Still requiring migration/removal

- `getPageCount` stays local only for UI/view state; it does not mutate PDF content. If strict “no local PDF library at all” is required, replace this with page count returned during upload and redesign the document view.
- `runBatch` remains a local concurrency scheduler only. Its actual transformations now call the migrated API functions.
- Mobile currently offers unsupported page reorder, selected-page rotation, target compression, normalize, and title read operations. Disable/remove these controls and update action sheets instead of allowing an error after tap.
- `apps/mobile/src/App.tsx` still claims “Offline PDF tools” and shows “offline”; change copy to “Cloud processing via iLovePDF” and describe the upload behavior.
- Test React Native’s multipart Blob/FormData behavior on a physical device or emulator. If it fails, adapt `packages/ilovepdf-api` upload to React Native’s supported FormData file representation using the picker URI instead of byte Blob.
- The Android manifest already contains INTERNET permission; amend its comments because production API calls now require it.

## Package lock and dependencies

Package manifest declarations were updated, but `pnpm install --lockfile-only` was blocked by sandbox registry access and did not complete. It created `D:\Projects\pdf-handling\.pnpm-store\`; this is an untracked temporary directory, not source code. A background pnpm process temporarily holds its database files.

After that process exits, delete `.pnpm-store/` and run from a normal network-enabled shell:

```powershell
pnpm install
```

This must update `pnpm-lock.yaml` and create workspace links for `@pdfx/ilovepdf-api`. Then run direct type checks/builds.

## Verification status

Passed before the latest mobile compatibility patch:

```powershell
& .\node_modules\.bin\tsc.cmd --noEmit -p packages\ilovepdf-api\tsconfig.json
& .\node_modules\.bin\tsc.cmd --noEmit -p apps\desktop\tsconfig.json
```

The latest mobile compatibility patch needs a fresh check. It made `unavailable<T>` generic in the mobile operations layer and added React Native-compatible Blob/FormData typing in the shared client. Run:

```powershell
& .\node_modules\.bin\tsc.cmd --noEmit -p apps\mobile\tsconfig.json
```

Still not verified:

- New API client type checks.
- Electron type check/build/package.
- API authentication with the configured private key.
- Real iLovePDF processing round trip.
- Electron installer creation and installation.
- Installed Electron configuration file behavior.
- Mobile Metro/type check.
- Android debug/release APK build and device installation.
- End-to-end Android iLovePDF upload/process/download.
- README/setup guide accuracy.
- Git commit/push.
- Full project code review and review-fix commit/push.

The prior attempted `pnpm install --lockfile-only` failed due restricted registry access; do not treat any package build as passing until rerun successfully after a proper install.

## Required next steps, in order

1. Wait for/stop only the failed pnpm process, delete `.pnpm-store/`, then run `pnpm install` with working registry access.
2. Finish desktop conversion migration and remove/disable every local mutation pathway listed above.
3. Finish mobile UI migration and remove/disable unsupported API-less commands.
4. Update `README.md`, `build_guide.md`, and `PROGRESS.md` from “offline” claims to accurate iLovePDF cloud-processing behavior, privacy notes, API credit requirements, development `.env`, and installed `iloveapi.json` setup.
5. Add automated client tests using a mocked `fetch` to validate auth/start/upload/process/download request construction without consuming API credits.
6. Run TypeScript, lint, and relevant tests.
7. Test at least one real PDF with desktop API flow using the private key from `.env`.
8. Build Electron package with `pnpm --filter @pdfx/desktop package`; locate `apps/desktop/release/PDFX-Setup-*.exe`.
9. Run the installer only after it builds, create `%APPDATA%\PDFX\iloveapi.json`, launch the installed app, and verify a real API operation.
10. Commit/push the desktop/API migration and setup guide.
11. Build Android APK with `cd apps/mobile/android; .\gradlew.bat assembleRelease` (or debug if release signing is not configured). Verify shared iLovePDF API flow on device/emulator.
12. Commit/push the APK-related source and documentation changes. Do not commit APK binaries unless the project’s release strategy explicitly requires it; attach them to GitHub releases instead.
13. Review the entire project relative to `origin/main`, fix concrete issues, run final checks, commit/push fixes.

## Git and safety notes

- Git requires `-c safe.directory=D:/Projects/pdf-handling` in this sandbox because repository ownership differs from the sandbox user.
- Remote: `https://github.com/pachisiav11/pdf-handling.git`.
- Do not commit `.env`; `.gitignore` already excludes it.
- Preserve the user’s unrelated `apps/mobile/android/gradle.properties` change unless they explicitly ask to alter it.
- No commits or pushes have been made during this migration yet.

## iLovePDF API references used

- API workflow and authentication: https://www.iloveapi.com/docs/api-reference
- Official Node library: https://github.com/ilovepdf/ilovepdf-nodejs
- The API documentation states that the private key must never be exposed client-side; it supports public `/auth` tokens for client-side use and recommends IP/domain filtering.

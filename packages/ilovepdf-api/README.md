# @pdfx/ilovepdf-api — not in use

This package is a dependency-free client for the iLovePDF REST API. It was written for a
short-lived migration that sent every PDF operation to iLovePDF's servers. PDFX has since
returned to fully local processing, so neither app imports this package any more.

It is kept, disconnected, for reference and in case a cloud option is wanted later:

- `src/index.ts` — auth (public `/v1/auth` or an injected token provider), start → upload →
  process → download, hand-built multipart bodies that work under React Native, timeouts,
  retry on 429/5xx, one re-auth on 401, and task-status polling.
- `test/client.test.ts` — mocked-fetch tests; no API credits are used.

`apps/mobile/src/lib/operations.ts` is the matching, also unused, mobile wrapper.

The Electron main process no longer signs API tokens. If a private key was ever placed in the
repository-root `.env` or in `%APPDATA%\PDFX\iloveapi.json`, nothing reads it now; consider
revoking it in the iLovePDF developer dashboard.

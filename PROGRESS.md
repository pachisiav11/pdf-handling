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

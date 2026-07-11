/** Node-only loader for @napi-rs/canvas. The specifier is a variable so
    browser bundlers (Vite/Metro) never try to resolve the native module —
    these code paths only run under Node (Electron main, tests). */
const NAPI_CANVAS = '@napi-rs/canvas';

export async function loadNodeCanvas(): Promise<typeof import('@napi-rs/canvas')> {
  return import(/* @vite-ignore */ NAPI_CANVAS);
}

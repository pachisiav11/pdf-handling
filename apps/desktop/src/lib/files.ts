import { openBytes, showNotice, actions, getState } from '../state/store';

declare global {
  interface Window {
    pdfx: {
      openPdfs(): Promise<Array<{ fileName: string; filePath: string; bytes: ArrayBuffer }>>;
      savePdf(defaultName: string, bytes: ArrayBuffer, extension?: string): Promise<string | null>;
    };
  }
}

// Dev-only bridge shim: lets the renderer run in a plain browser (no Electron)
// for automated UI checks. Native dialogs are stubbed; saved bytes are kept on
// window.__lastSaved so tests can reopen and verify them.
if (import.meta.env.DEV && typeof window !== 'undefined' && !('pdfx' in window)) {
  (window as unknown as { __lastSaved?: Uint8Array }).__lastSaved = undefined;
  window.pdfx = {
    async openPdfs() {
      const res = await fetch('/dev-sample.pdf');
      return [{ fileName: 'dev-sample.pdf', filePath: 'DEV://dev-sample.pdf', bytes: await res.arrayBuffer() }];
    },
    async savePdf(defaultName, bytes) {
      (window as unknown as { __lastSaved?: Uint8Array }).__lastSaved = new Uint8Array(bytes);
      return `DEV://${defaultName}`;
    },
  };
}

export async function openViaDialog(): Promise<void> {
  const files = await window.pdfx.openPdfs();
  for (const f of files) await openBytes(f.fileName, new Uint8Array(f.bytes));
}

export async function openDroppedFiles(list: FileList | File[]): Promise<void> {
  for (const file of Array.from(list)) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showNotice(`Skipped ${file.name} — only PDF files can be opened here.`);
      continue;
    }
    await openBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  }
}

/** Save arbitrary bytes via the native dialog. Returns true if saved. */
export async function saveBytesAs(
  defaultName: string,
  bytes: Uint8Array,
  extension: 'pdf' | 'zip' = 'pdf',
): Promise<boolean> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const path = await window.pdfx.savePdf(defaultName, buf as ArrayBuffer, extension);
  if (path) showNotice(`Saved to ${path}`);
  return path !== null;
}

/** Save the active document and clear its unsaved-changes marker. */
export async function saveActiveDoc(): Promise<void> {
  const doc = getState().docs.find((d) => d.id === getState().activeId);
  if (!doc) return;
  const t0 = performance.now();
  const saved = await saveBytesAs(doc.fileName, doc.bytes, 'pdf');
  if (saved) {
    actions.markSaved(doc.id);
    const ms = Math.round(performance.now() - t0);
    console.info(`[pdfx] save completed in ${ms}ms`);
  }
}

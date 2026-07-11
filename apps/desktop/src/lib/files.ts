import { openBytes, showNotice, actions, getState } from '../state/store';

interface OpenedFile {
  fileName: string;
  filePath: string;
  bytes: ArrayBuffer;
}

declare global {
  interface Window {
    pdfx: {
      openPdfs(): Promise<OpenedFile[]>;
      openImages(): Promise<OpenedFile[]>;
      savePdf(defaultName: string, bytes: ArrayBuffer, extension?: string): Promise<string | null>;
      convertOffice(): Promise<OpenedFile | { error: string } | null>;
      runOcr(bytes: ArrayBuffer): Promise<unknown>;
      logError?(message: string): void;
      recentList?(): Promise<Array<{ path: string; name: string; openedAt: number }>>;
      recentAdd?(entry: { path: string; name: string }): Promise<void>;
      recentOpen?(path: string): Promise<OpenedFile | null>;
      onOcrProgress(cb: (p: { done: number; total: number }) => void): () => void;
    };
  }
}

// Dev-only bridge shim: lets the renderer run in a plain browser (no Electron)
// for automated UI checks. Native dialogs are stubbed; saved bytes are kept on
// window.__lastSaved so tests can reopen and verify them.
if (import.meta.env.DEV && typeof window !== 'undefined' && !('pdfx' in window)) {
  (window as unknown as { __lastSaved?: Uint8Array }).__lastSaved = undefined;
  (window as Window).pdfx = {
    async openPdfs() {
      const names = ['dev-sample.pdf', 'dev-form.pdf'];
      return Promise.all(
        names.map(async (n) => ({
          fileName: n,
          filePath: `DEV://${n}`,
          bytes: await (await fetch(`/${n}`)).arrayBuffer(),
        })),
      );
    },
    async savePdf(defaultName: string, bytes: ArrayBuffer) {
      (window as unknown as { __lastSaved?: Uint8Array }).__lastSaved = new Uint8Array(bytes);
      return `DEV://${defaultName}`;
    },
    async openImages() {
      return [];
    },
    async convertOffice() {
      return { error: 'Office conversion requires the desktop app (LibreOffice).' };
    },
    async runOcr() {
      return { error: 'OCR runs in the desktop app main process — not available in browser dev.' };
    },
    onOcrProgress() {
      return () => undefined;
    },
  };
}

export async function openViaDialog(): Promise<void> {
  const files = await window.pdfx.openPdfs();
  for (const f of files) {
    await openBytes(f.fileName, new Uint8Array(f.bytes));
    if (!f.filePath.startsWith('DEV://')) {
      void window.pdfx.recentAdd?.({ path: f.filePath, name: f.fileName });
    }
  }
}

export async function openRecent(path: string): Promise<boolean> {
  const file = await window.pdfx.recentOpen?.(path);
  if (!file) return false;
  await openBytes(file.fileName, new Uint8Array(file.bytes));
  void window.pdfx.recentAdd?.({ path: file.filePath, name: file.fileName });
  return true;
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
  extension: 'pdf' | 'zip' | 'txt' | 'png' | 'jpg' = 'pdf',
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

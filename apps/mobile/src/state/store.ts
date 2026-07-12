import { useSyncExternalStore } from 'react';
import {
  getPageCount,
  rotatePages,
  deletePages,
  extractPages,
  reorderPages,
  mergePdfs,
  splitByRange,
  compressPdf,
  addWatermark,
  addPageNumbers,
  compressToTargetSize,
  normalizePageSize,
  setTitle,
  getTitle,
  runBatch,
  type RotationDelta,
  type CompressPreset,
  type NumberPosition,
  type PaperSize,
} from '@pdfx/core/mobile';
import { pickPdf, pickPdfs, savePdfToDownloads } from '../lib/files';

export interface Doc {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  dirty: boolean;
  history: Uint8Array[];
  future: Uint8Array[];
}

export interface State {
  doc: Doc | null;
  selection: number[]; // 0-based page indices
  busy: string | null;
  error: string | null;
  notice: string | null;
}

const MAX_HISTORY = 20;

let state: State = { doc: null, selection: [], busy: null, error: null, notice: null };
const listeners = new Set<() => void>();

function emit(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function useStore(): State {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export const getState = (): State => state;

function setError(err: unknown): void {
  emit({ busy: null, error: err instanceof Error ? err.message : String(err) });
}

export function clearError(): void {
  emit({ error: null });
}

export function showNotice(notice: string): void {
  emit({ notice });
  setTimeout(() => {
    if (state.notice === notice) emit({ notice: null });
  }, 3500);
}

export function toggleSelect(index: number): void {
  const sel = state.selection.includes(index)
    ? state.selection.filter((i) => i !== index)
    : [...state.selection, index].sort((a, b) => a - b);
  emit({ selection: sel });
}

export function clearSelection(): void {
  emit({ selection: [] });
}

async function makeDoc(name: string, bytes: Uint8Array): Promise<Doc> {
  return { name, bytes, pageCount: await getPageCount(bytes), dirty: false, history: [], future: [] };
}

export async function openViaPicker(): Promise<void> {
  if (state.busy) return;
  emit({ busy: 'Opening' });
  try {
    const picked = await pickPdf();
    if (!picked) {
      emit({ busy: null });
      return;
    }
    const doc = await makeDoc(picked.name, picked.bytes);
    emit({ busy: null, doc, selection: [], error: null });
  } catch (err) {
    setError(err);
  }
}

export function closeDoc(): void {
  emit({ doc: null, selection: [], notice: null });
}

/** Run a transform that returns new bytes for the active doc, with undo snapshot. */
async function mutate(label: string, fn: (bytes: Uint8Array) => Promise<Uint8Array>): Promise<void> {
  const doc = state.doc;
  if (!doc || state.busy) return;
  emit({ busy: label });
  try {
    const nextBytes = await fn(doc.bytes);
    const pageCount = await getPageCount(nextBytes);
    emit({
      busy: null,
      selection: [],
      doc: {
        ...doc,
        bytes: nextBytes,
        pageCount,
        dirty: true,
        history: [...doc.history.slice(-(MAX_HISTORY - 1)), doc.bytes],
        future: [],
      },
    });
  } catch (err) {
    setError(err);
  }
}

export const actions = {
  rotate(delta: RotationDelta) {
    const sel = state.selection;
    return mutate(sel.length ? `Rotating ${sel.length} page(s)` : 'Rotating all pages', (b) =>
      rotatePages(b, delta, sel.length ? sel : undefined),
    );
  },

  deleteSelected() {
    const sel = state.selection;
    if (!sel.length) return Promise.resolve();
    if (state.doc && sel.length >= state.doc.pageCount) {
      emit({ error: 'Cannot delete every page.' });
      return Promise.resolve();
    }
    return mutate(`Deleting ${sel.length} page(s)`, (b) => deletePages(b, sel));
  },

  /** Move selected pages to the front, preserving order; save nothing — in place. */
  moveSelectedToFront() {
    const doc = state.doc;
    const sel = state.selection;
    if (!doc || !sel.length) return Promise.resolve();
    const rest = Array.from({ length: doc.pageCount }, (_, i) => i).filter((i) => !sel.includes(i));
    const order = [...sel, ...rest];
    return mutate('Reordering pages', (b) => reorderPages(b, order));
  },

  compress(preset: CompressPreset) {
    return mutate(`Compressing (${preset})`, (b) => compressPdf(b, preset));
  },

  /**
   * Target-size compression. On mobile there is no image re-encoder (no canvas),
   * so this can only losslessly re-save — it honestly reports when a requested
   * size is below what lossless alone can achieve.
   */
  async compressToTarget(targetBytes: number) {
    const doc = state.doc;
    if (!doc || state.busy) return;
    emit({ busy: 'Compressing to size' });
    try {
      const res = await compressToTargetSize(doc.bytes, targetBytes);
      if (!res.ok) {
        emit({ busy: null });
        showNotice(res.message);
        return;
      }
      const pageCount = await getPageCount(res.bytes);
      emit({
        busy: null,
        selection: [],
        doc: {
          ...doc,
          bytes: res.bytes,
          pageCount,
          dirty: true,
          history: [...doc.history.slice(-(MAX_HISTORY - 1)), doc.bytes],
          future: [],
        },
      });
      showNotice(`Compressed to ${(res.size / (1024 * 1024)).toFixed(1)}MB.`);
    } catch (err) {
      setError(err);
    }
  },

  normalize(size: PaperSize) {
    return mutate(`Normalizing to ${size.toUpperCase()}`, (b) => normalizePageSize(b, size));
  },

  setTitle(title: string) {
    return mutate('Set title', (b) => setTitle(b, title));
  },

  getCurrentTitle() {
    const doc = state.doc;
    if (!doc) return Promise.resolve('');
    return getTitle(doc.bytes);
  },

  watermark(text: string) {
    return mutate('Adding watermark', (b) => addWatermark(b, { text }));
  },

  pageNumbers(position: NumberPosition) {
    return mutate('Adding page numbers', (b) => addPageNumbers(b, { position }));
  },

  /** Rotate/delete/extract a single page (mobile long-press action sheet). */
  rotatePage(index: number) {
    return mutate('Rotating page', (b) => rotatePages(b, 90, [index]));
  },
  deletePage(index: number) {
    const doc = state.doc;
    if (doc && doc.pageCount <= 1) {
      emit({ error: 'Cannot delete every page.' });
      return Promise.resolve();
    }
    return mutate('Deleting page', (b) => deletePages(b, [index]));
  },
  async extractPageToDownloads(index: number) {
    const doc = state.doc;
    if (!doc || state.busy) return;
    emit({ busy: 'Extracting page' });
    try {
      const out = await extractPages(doc.bytes, [index]);
      const loc = await savePdfToDownloads(
        doc.name.replace(/\.pdf$/i, '') + `-page-${index + 1}.pdf`,
        out,
      );
      emit({ busy: null, selection: [] });
      showNotice(`Saved ${loc}`);
    } catch (err) {
      setError(err);
    }
  },

  /**
   * Batch: pick N PDFs, apply one operation to each via a bounded pool
   * (concurrency 2 on mobile), and save every result to Downloads. A failed
   * file never aborts the rest.
   */
  async batch(op: 'compress-medium' | 'rotate90' | 'normalize-a4' | 'watermark') {
    if (state.busy) return;
    try {
      const files = await pickPdfs();
      if (!files.length) return;
      emit({ busy: `Batch: 0/${files.length}` });
      const apply = (b: Uint8Array): Promise<Uint8Array> => {
        switch (op) {
          case 'compress-medium':
            return compressPdf(b, 'medium');
          case 'rotate90':
            return rotatePages(b, 90);
          case 'normalize-a4':
            return normalizePageSize(b, 'a4');
          case 'watermark':
            return addWatermark(b, { text: 'DRAFT' });
        }
      };
      const suffix =
        op === 'compress-medium'
          ? 'compressed'
          : op === 'rotate90'
            ? 'rotated'
            : op === 'normalize-a4'
              ? 'a4'
              : 'draft';
      const summary = await runBatch(
        files,
        async (f) => {
          const out = await apply(f.bytes);
          await savePdfToDownloads(f.name.replace(/\.pdf$/i, '') + `-${suffix}.pdf`, out);
          return out;
        },
        {
          concurrency: 2,
          onUpdate: (_item, s) => emit({ busy: `Batch: ${s.done}/${s.total}` }),
        },
      );
      emit({ busy: null });
      showNotice(
        `${summary.succeeded} saved to Downloads` +
          (summary.failed ? `, ${summary.failed} failed` : '') + '.',
      );
    } catch (err) {
      setError(err);
    }
  },

  undo() {
    const doc = state.doc;
    if (!doc || !doc.history.length) return;
    const prev = doc.history[doc.history.length - 1];
    getPageCount(prev).then((pageCount) => {
      emit({
        selection: [],
        doc: {
          ...doc,
          bytes: prev,
          pageCount,
          dirty: true,
          history: doc.history.slice(0, -1),
          future: [...doc.future, doc.bytes],
        },
      });
    });
  },

  redo() {
    const doc = state.doc;
    if (!doc || !doc.future.length) return;
    const next = doc.future[doc.future.length - 1];
    getPageCount(next).then((pageCount) => {
      emit({
        selection: [],
        doc: {
          ...doc,
          bytes: next,
          pageCount,
          dirty: true,
          future: doc.future.slice(0, -1),
          history: [...doc.history, doc.bytes],
        },
      });
    });
  },

  /** Pick a second PDF and append it to the active document. */
  async mergeAnother() {
    const doc = state.doc;
    if (!doc || state.busy) return;
    try {
      const picked = await pickPdf();
      if (!picked) return;
      await mutate(`Merging ${picked.name}`, (b) => mergePdfs([b, picked.bytes]));
      showNotice(`Merged ${picked.name}`);
    } catch (err) {
      setError(err);
    }
  },

  /** Extract a page range into a separate PDF and save it to Downloads. */
  async splitToDownloads(rangeStr: string) {
    const doc = state.doc;
    if (!doc || state.busy) return;
    emit({ busy: 'Splitting' });
    try {
      const out = await splitByRange(doc.bytes, rangeStr);
      const loc = await savePdfToDownloads(doc.name.replace(/\.pdf$/i, '') + `-${rangeStr}.pdf`, out);
      emit({ busy: null });
      showNotice(`Saved ${loc}`);
    } catch (err) {
      setError(err);
    }
  },

  /** Extract selected pages into a separate PDF saved to Downloads. */
  async extractToDownloads() {
    const doc = state.doc;
    const sel = state.selection;
    if (!doc || !sel.length || state.busy) return;
    emit({ busy: `Extracting ${sel.length} page(s)` });
    try {
      const out = await extractPages(doc.bytes, sel);
      const loc = await savePdfToDownloads(doc.name.replace(/\.pdf$/i, '') + '-extract.pdf', out);
      emit({ busy: null, selection: [] });
      showNotice(`Saved ${loc}`);
    } catch (err) {
      setError(err);
    }
  },

  async save() {
    const doc = state.doc;
    if (!doc || state.busy) return;
    emit({ busy: 'Saving' });
    try {
      const loc = await savePdfToDownloads(doc.name, doc.bytes);
      emit({ busy: null, doc: { ...doc, dirty: false } });
      showNotice(`Saved ${loc}`);
    } catch (err) {
      setError(err);
    }
  },
};

import { useSyncExternalStore } from 'react';
import { getPageCount } from '@pdfx/core';
import type {
  FieldValue,
  Markup,
  NewFieldSpec,
  PageNumberOptions,
  Rect,
  Stamp,
  Stroke,
  TextItem,
  WatermarkOptions,
} from '@pdfx/core';
import { ops } from '../pdf/opsClient';
import { rasterizeRedactedPage, releaseRenderDoc } from '../pdf/render';

/** A pre-op document snapshot with the label of the op that superseded it. */
export interface Snapshot {
  label: string;
  bytes: Uint8Array;
}

export interface DocState {
  id: string;
  fileName: string;
  bytes: Uint8Array;
  version: number; // bumped on every mutation; drives render-cache invalidation
  pageCount: number;
  dirty: boolean;
  history: Snapshot[]; // pre-op snapshots for undo (session-scoped, labeled)
  future: Snapshot[]; // redo stack
}

/** Dialogs routed through the store so shortcuts + command palette can open them. */
export type DialogName =
  | 'split'
  | 'merge'
  | 'pagenumbers'
  | 'watermark'
  | 'sign'
  | 'initials'
  | 'ocr'
  | 'metadata'
  | 'normalize'
  | 'compress'
  | 'batch';

export interface AppState {
  docs: DocState[];
  activeId: string | null;
  selection: number[]; // selected page indices in the active doc
  viewerPage: number | null; // page open in the large viewer, null = grid only
  busy: string | null; // label of the running operation
  error: string | null;
  notice: string | null;
  /** A signature/initials PNG waiting to be placed via the viewer's stamp mode. */
  stampRequest: { bytes: Uint8Array; label: string } | null;
  /** Dialog requested via shortcut/palette/toolbar; the Workspace renders it. */
  pendingDialog: DialogName | null;
  /** Whether the Ctrl+K command palette is open. */
  paletteOpen: boolean;
  /** Redaction mode toggle (Ctrl+Shift+R), consumed by the Viewer. */
  redactMode: boolean;
}

const MAX_HISTORY = 20;

let state: AppState = {
  docs: [],
  activeId: null,
  selection: [],
  viewerPage: null,
  busy: null,
  error: null,
  notice: null,
  stampRequest: null,
  pendingDialog: null,
  paletteOpen: false,
  redactMode: false,
};

const listeners = new Set<() => void>();

function emit(next: Partial<AppState>): void {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export const getState = (): AppState => state;

export function activeDoc(): DocState | null {
  return state.docs.find((d) => d.id === state.activeId) ?? null;
}

// ---- document lifecycle ----

export async function openBytes(fileName: string, bytes: Uint8Array): Promise<void> {
  try {
    const pageCount = await getPageCount(bytes);
    const doc: DocState = {
      id: crypto.randomUUID(),
      fileName,
      bytes,
      version: 0,
      pageCount,
      dirty: false,
      history: [],
      future: [],
    };
    emit({
      docs: [...state.docs, doc],
      activeId: doc.id,
      selection: [],
      viewerPage: null,
      redactMode: false,
    });
  } catch (err) {
    emit({ error: err instanceof Error ? err.message : String(err) });
  }
}

export function closeDoc(id: string): void {
  releaseRenderDoc(id);
  const docs = state.docs.filter((d) => d.id !== id);
  emit({
    docs,
    activeId: state.activeId === id ? (docs[docs.length - 1]?.id ?? null) : state.activeId,
    selection: [],
    viewerPage: null,
  });
}

export function setActive(id: string): void {
  emit({ activeId: id, selection: [], viewerPage: null });
}

export function setSelection(selection: number[]): void {
  emit({ selection });
}

export function setViewerPage(page: number | null): void {
  emit({ viewerPage: page });
}

/** Ask the viewer to enter stamp-placement mode with this PNG (signature flow). */
export function requestStampPlacement(bytes: Uint8Array, label: string): void {
  emit({
    stampRequest: { bytes, label },
    viewerPage: state.viewerPage ?? 0, // open the viewer if it isn't
  });
}

export function clearStampRequest(): void {
  emit({ stampRequest: null });
}

export function clearError(): void {
  emit({ error: null });
}

// ---- dialog / command-palette / redaction routing ----

export function openDialog(name: DialogName): void {
  emit({ pendingDialog: name, paletteOpen: false });
}

export function closeDialog(): void {
  emit({ pendingDialog: null });
}

export function setPaletteOpen(open: boolean): void {
  emit({ paletteOpen: open });
}

export function toggleRedactMode(): void {
  const next = !state.redactMode;
  emit({
    redactMode: next,
    paletteOpen: false,
    // Redaction happens on the rendered page, so make sure the viewer is open.
    viewerPage: next && state.viewerPage === null ? (state.selection[0] ?? 0) : state.viewerPage,
  });
}

export function showNotice(notice: string): void {
  emit({ notice });
  setTimeout(() => {
    if (state.notice === notice) emit({ notice: null });
  }, 3500);
}

// ---- mutations (all via worker; snapshot for undo) ----

async function mutateActive(
  label: string,
  fn: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  const doc = activeDoc();
  if (!doc || state.busy) return;
  emit({ busy: label });
  try {
    const nextBytes = await fn(doc.bytes);
    const pageCount = await getPageCount(nextBytes);
    updateDoc(doc.id, (d) => ({
      ...d,
      bytes: nextBytes,
      version: d.version + 1,
      pageCount,
      dirty: true,
      history: [...d.history.slice(-(MAX_HISTORY - 1)), { label, bytes: d.bytes }],
      future: [],
    }));
    emit({
      busy: null,
      selection: [],
      viewerPage:
        state.viewerPage !== null ? Math.min(state.viewerPage, pageCount - 1) : null,
    });
  } catch (err) {
    emit({ busy: null, error: err instanceof Error ? err.message : String(err) });
  }
}

function updateDoc(id: string, fn: (d: DocState) => DocState): void {
  emit({ docs: state.docs.map((d) => (d.id === id ? fn(d) : d)) });
}

export const actions = {
  rotateSelection: (delta: 90 | 180 | 270) => {
    const sel = state.selection;
    return mutateActive(`Rotating ${sel.length || 'all'} page(s)`, (b) =>
      ops.rotatePages(b, delta, sel.length ? sel : undefined),
    );
  },
  deleteSelection: () => {
    const sel = state.selection;
    if (!sel.length) return Promise.resolve();
    return mutateActive(`Deleting ${sel.length} page(s)`, (b) => ops.deletePages(b, sel));
  },
  reorder: (newOrder: number[]) =>
    mutateActive('Reordering pages', (b) => ops.reorderPages(b, newOrder)),
  /** Copy the selected pages into a new document tab. */
  extractSelection: async () => {
    const doc = activeDoc();
    const sel = state.selection;
    if (!doc || !sel.length || state.busy) return;
    emit({ busy: `Extracting ${sel.length} page(s)` });
    try {
      const bytes = await ops.extractPages(doc.bytes, sel);
      emit({ busy: null });
      await openBytes(doc.fileName.replace(/\.pdf$/i, '') + '-extract.pdf', bytes);
    } catch (err) {
      emit({ busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  },
  compress: (preset: 'low' | 'medium' | 'high') =>
    mutateActive(`Compressing (${preset})`, (b) => ops.compress(b, preset)),

  /** Target-size compression (Phase 9). Reports plainly if it can't hit the size. */
  compressToTarget: async (targetBytes: number) => {
    const doc = activeDoc();
    if (!doc || state.busy) return;
    const human = `${(targetBytes / (1024 * 1024)).toFixed(1)}MB`;
    emit({ busy: `Compressing to ~${human}` });
    try {
      const res = await ops.compressTarget(doc.bytes, targetBytes);
      if (!res.ok) {
        emit({ busy: null });
        showNotice(res.message);
        return;
      }
      const pageCount = await getPageCount(res.bytes);
      updateDoc(doc.id, (d) => ({
        ...d,
        bytes: res.bytes,
        version: d.version + 1,
        pageCount,
        dirty: true,
        history: [...d.history.slice(-(MAX_HISTORY - 1)), { label: 'Compress to size', bytes: d.bytes }],
        future: [],
      }));
      emit({ busy: null, selection: [] });
      showNotice(`Compressed to ${(res.size / (1024 * 1024)).toFixed(1)}MB.`);
    } catch (err) {
      emit({ busy: null, error: err instanceof Error ? err.message : String(err) });
    }
  },

  normalize: (size: import('@pdfx/core').PaperSize) =>
    mutateActive(`Normalizing to ${size.toUpperCase()}`, (b) => ops.normalize(b, size)),

  setTitle: (title: string) => mutateActive('Set title', (b) => ops.setTitle(b, title)),

  undo: () => {
    const doc = activeDoc();
    if (!doc || !doc.history.length) return;
    const snap = doc.history[doc.history.length - 1]!;
    getPageCount(snap.bytes).then((pageCount) => {
      updateDoc(doc.id, (d) => ({
        ...d,
        bytes: snap.bytes,
        version: d.version + 1,
        pageCount,
        history: d.history.slice(0, -1),
        // redo re-applies the op we just reversed — carry its label forward.
        future: [...d.future, { label: snap.label, bytes: d.bytes }],
        dirty: true,
      }));
      emit({ selection: [], viewerPage: null });
    });
  },
  redo: () => {
    const doc = activeDoc();
    if (!doc || !doc.future.length) return;
    const snap = doc.future[doc.future.length - 1]!;
    getPageCount(snap.bytes).then((pageCount) => {
      updateDoc(doc.id, (d) => ({
        ...d,
        bytes: snap.bytes,
        version: d.version + 1,
        pageCount,
        future: d.future.slice(0, -1),
        history: [...d.history, { label: snap.label, bytes: d.bytes }],
        dirty: true,
      }));
      emit({ selection: [], viewerPage: null });
    });
  },

  markSaved: (id: string) => updateDoc(id, (d) => ({ ...d, dirty: false })),

  // ---- editing (Phase 3) ----
  applyText: (items: TextItem[]) =>
    mutateActive(`Adding ${items.length} text item(s)`, (b) => ops.addText(b, items)),
  applyMarkups: (markups: Markup[]) =>
    mutateActive('Applying markup', (b) => ops.addMarkups(b, markups)),
  applyStrokes: (strokes: Stroke[]) =>
    mutateActive('Committing drawing', (b) => ops.addStrokes(b, strokes)),
  applyStamps: (stamps: Stamp[]) =>
    mutateActive('Placing image', (b) => ops.addStamps(b, stamps)),
  applyPageNumbers: (options: PageNumberOptions) =>
    mutateActive('Adding page numbers', (b) => ops.pageNumbers(b, options)),
  applyWatermark: (options: WatermarkOptions) =>
    mutateActive('Applying watermark', (b) => ops.watermark(b, options)),
  applyCrop: (box: Rect, indices?: number[]) =>
    mutateActive('Cropping', (b) => ops.crop(b, box, indices)),
  // ---- forms (Phase 4) ----
  fillFields: (values: FieldValue[]) =>
    mutateActive(`Filling ${values.length} field(s)`, (b) => ops.fillFields(b, values)),
  createFields: (specs: NewFieldSpec[]) =>
    mutateActive('Creating form field', (b) => ops.createFields(b, specs)),

  applyRedaction: (regions: Array<{ pageIndex: number; rects: Rect[] }>) => {
    const doc = activeDoc();
    if (!doc) return Promise.resolve();
    return mutateActive('Redacting (pages become images)', async (b) => {
      const replacements = [];
      for (const region of regions) {
        if (!region.rects.length) continue;
        replacements.push({
          pageIndex: region.pageIndex,
          png: await rasterizeRedactedPage(doc.id, doc.version, b, region.pageIndex, region.rects),
        });
      }
      return ops.replacePages(b, replacements);
    });
  },
};

// ---- multi-doc / export operations (used by dialogs) ----

export async function runExportOp(
  label: string,
  fn: () => Promise<Uint8Array>,
): Promise<Uint8Array | null> {
  if (state.busy) return null;
  emit({ busy: label });
  try {
    const bytes = await fn();
    emit({ busy: null });
    return bytes;
  } catch (err) {
    emit({ busy: null, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

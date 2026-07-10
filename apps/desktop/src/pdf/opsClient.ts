import type { OpRequest, OpResponse } from './ops.worker';

/** Promise RPC over the ops worker. One worker instance for the app. */
const worker = new Worker(new URL('./ops.worker.ts', import.meta.url), { type: 'module' });

let nextId = 1;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

worker.onmessage = (e: MessageEvent<OpResponse>) => {
  const res = e.data;
  const entry = pending.get(res.id);
  if (!entry) return;
  pending.delete(res.id);
  if (res.ok) entry.resolve(res.bytes);
  else entry.reject(new Error(res.message));
};

// Omit over a discriminated union must distribute, or only common keys survive.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function call(
  req: DistributiveOmit<OpRequest, 'id'>,
  transfer: ArrayBuffer[] = [],
): Promise<Uint8Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...req, id }, transfer);
  });
}

// Bytes are copied (not transferred) so callers keep their working copy for undo.
export const ops = {
  merge: (sources: Uint8Array[]) => call({ op: 'merge', sources: sources.map((s) => s.slice()) }),
  splitRange: (bytes: Uint8Array, range: string) =>
    call({ op: 'splitRange', bytes: bytes.slice(), range }),
  splitAll: (bytes: Uint8Array, baseName: string) =>
    call({ op: 'splitAll', bytes: bytes.slice(), baseName }),
  deletePages: (bytes: Uint8Array, indices: number[]) =>
    call({ op: 'deletePages', bytes: bytes.slice(), indices }),
  extractPages: (bytes: Uint8Array, indices: number[]) =>
    call({ op: 'extractPages', bytes: bytes.slice(), indices }),
  reorderPages: (bytes: Uint8Array, newOrder: number[]) =>
    call({ op: 'reorderPages', bytes: bytes.slice(), newOrder }),
  rotatePages: (bytes: Uint8Array, delta: 90 | 180 | 270, indices?: number[]) =>
    call({ op: 'rotatePages', bytes: bytes.slice(), delta, indices }),
  compress: (bytes: Uint8Array, preset: 'low' | 'medium' | 'high') =>
    call({ op: 'compress', bytes: bytes.slice(), preset }),
};

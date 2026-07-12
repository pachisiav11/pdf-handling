/**
 * Bounded-concurrency batch runner (build guide "Batch processing architecture").
 * Applies one async `worker` to N inputs with at most `concurrency` in flight at
 * once — a queue, NOT fire-all-at-once — reporting per-item state transitions
 * (queued → running → done | failed) and never aborting the whole batch when a
 * single item throws. Platform-agnostic: desktop passes a concurrency of
 * min(4, cpus), mobile passes 2.
 */

export type BatchItemStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BatchItem<TIn, TOut> {
  index: number;
  input: TIn;
  status: BatchItemStatus;
  result?: TOut;
  error?: string;
}

export interface BatchSummary<TIn, TOut> {
  items: BatchItem<TIn, TOut>[];
  succeeded: number;
  failed: number;
}

export interface BatchOptions<TIn, TOut> {
  concurrency: number;
  /** Called on every status transition so a UI list can live-update. */
  onUpdate?: (item: BatchItem<TIn, TOut>, summary: { done: number; total: number }) => void;
}

/**
 * Run `worker` across `inputs` with bounded concurrency. Resolves once every
 * item has settled; individual failures are captured on the item (`failed` +
 * `error`) and do not reject the returned promise.
 */
export async function runBatch<TIn, TOut>(
  inputs: TIn[],
  worker: (input: TIn, index: number) => Promise<TOut>,
  opts: BatchOptions<TIn, TOut>,
): Promise<BatchSummary<TIn, TOut>> {
  const items: BatchItem<TIn, TOut>[] = inputs.map((input, index) => ({
    index,
    input,
    status: 'queued',
  }));
  const total = items.length;
  let done = 0;
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(opts.concurrency, total || 1));

  const runOne = async (item: BatchItem<TIn, TOut>): Promise<void> => {
    item.status = 'running';
    opts.onUpdate?.(item, { done, total });
    try {
      item.result = await worker(item.input, item.index);
      item.status = 'done';
    } catch (err) {
      item.status = 'failed';
      item.error = err instanceof Error ? err.message : String(err);
    }
    done++;
    opts.onUpdate?.(item, { done, total });
  };

  // Each of `concurrency` runners pulls the next queued item until exhausted.
  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await runOne(item);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runner()));

  const failed = items.filter((i) => i.status === 'failed').length;
  return { items, succeeded: total - failed, failed };
}

/**
 * Session-scoped undo/redo for a single document (build guide "Undo/redo
 * architecture"). Every mutating op in this app is a whole-document transform
 * that returns fresh bytes, so the command stack stores **snapshots** of the
 * document bytes with a human label rather than per-op inverses — the guide
 * explicitly allows snapshotting where a true inverse is impractical, and here
 * it makes undo uniform and correct across every operation (including terminal
 * ones like compress/OCR that have no cheap inverse).
 *
 * The stack is capped by BOTH an entry count and a total-bytes budget; the
 * oldest states are dropped when either is exceeded so a long session can't grow
 * memory without bound. Undo/redo is session-scoped: build a fresh instance when
 * a document is opened, discard it when the document is closed.
 */

export interface HistoryLimits {
  /** Max retained states (present + past). Default 50. */
  maxEntries: number;
  /** Max total retained bytes across all states. Default 200 MB. */
  maxBytes: number;
}

const DEFAULT_LIMITS: HistoryLimits = { maxEntries: 50, maxBytes: 200 * 1024 * 1024 };

interface Snapshot {
  /** Label of the op that PRODUCED this state (empty string for the initial load). */
  label: string;
  bytes: Uint8Array;
}

export class DocumentHistory {
  private past: Snapshot[] = [];
  private present: Snapshot;
  private future: Snapshot[] = [];
  private readonly limits: HistoryLimits;

  constructor(initial: Uint8Array, limits: Partial<HistoryLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.present = { label: '', bytes: initial };
  }

  /** Current document bytes. */
  get current(): Uint8Array {
    return this.present.bytes;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Label of the op that undo would reverse (for menu/tooltip text), or null. */
  get undoLabel(): string | null {
    return this.canUndo ? this.present.label : null;
  }

  /** Label of the op that redo would re-apply, or null. */
  get redoLabel(): string | null {
    return this.canRedo ? this.future[this.future.length - 1]!.label : null;
  }

  /**
   * Commit a new state produced by an operation. Clears the redo stack (a new
   * edit forks history) and enforces the retention budget.
   */
  push(label: string, next: Uint8Array): void {
    this.past.push(this.present);
    this.present = { label, bytes: next };
    this.future = [];
    this.enforceBudget();
  }

  /** Step back one state; returns the now-current bytes, or null if nothing to undo. */
  undo(): Uint8Array | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.present);
    this.present = prev;
    return this.present.bytes;
  }

  /** Step forward one state; returns the now-current bytes, or null if nothing to redo. */
  redo(): Uint8Array | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.present);
    this.present = next;
    return this.present.bytes;
  }

  /** Drop the oldest past states until both the count and byte budgets are met. */
  private enforceBudget(): void {
    const totalEntries = () => this.past.length + 1 + this.future.length;
    const totalBytes = () =>
      this.past.reduce((n, s) => n + s.bytes.length, 0) +
      this.present.bytes.length +
      this.future.reduce((n, s) => n + s.bytes.length, 0);

    // Only the oldest *past* states are droppable (present/future must stay
    // reachable). Drop from the front of `past` until within budget.
    while (
      this.past.length > 0 &&
      (totalEntries() > this.limits.maxEntries || totalBytes() > this.limits.maxBytes)
    ) {
      this.past.shift();
    }
  }
}

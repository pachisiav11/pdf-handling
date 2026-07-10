export interface PdfDocumentHandle {
  id: string; // uuid, session-scoped
  fileName: string;
  bytes: Uint8Array; // current working bytes
  pageCount: number;
  sourcePath?: string; // undefined if not yet saved / opened without a stable path
}

export interface PageRef {
  docId: string;
  index: number; // 0-based, current position
  rotation: 0 | 90 | 180 | 270;
  originalIndex: number; // for undo bookkeeping
}

export type EditCommandType =
  | 'rotate'
  | 'delete-page'
  | 'reorder'
  | 'add-text'
  | 'draw'
  | 'watermark'
  | 'crop'
  | 'redact'
  | 'compress'
  | 'stamp'
  | 'page-numbers'
  | 'highlight'
  | 'form-fill'
  | 'signature';

export interface EditCommand {
  id: string;
  type: EditCommandType;
  params: Record<string, unknown>;
  inverse:
    | { kind: 'direct'; params: Record<string, unknown> } // reversible via a direct inverse op
    | { kind: 'snapshot'; bytesBefore: Uint8Array }; // full-document snapshot fallback
  timestamp: number;
}

import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// Inside a Web Worker pdf.js wires itself to `self` on import. On the main
// thread (fallback when workers are blocked) pdf.js looks for this global and
// runs its "fake worker" in-page instead.
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = { WorkerMessageHandler };

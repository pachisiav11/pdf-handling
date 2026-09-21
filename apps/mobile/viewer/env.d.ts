declare module 'pdfx:worker-source' {
  const source: string;
  export default source;
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}

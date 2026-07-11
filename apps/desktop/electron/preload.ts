import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedFile {
  fileName: string;
  filePath: string;
  bytes: ArrayBuffer;
}

export interface OcrProgress {
  done: number;
  total: number;
}

export interface PdfxBridge {
  openPdfs(): Promise<OpenedFile[]>;
  openImages(): Promise<OpenedFile[]>;
  savePdf(defaultName: string, bytes: ArrayBuffer, extension?: string): Promise<string | null>;
  convertOffice(): Promise<OpenedFile | { error: string } | null>;
  runOcr(bytes: ArrayBuffer): Promise<unknown>;
  onOcrProgress(cb: (p: OcrProgress) => void): () => void;
}

const bridge: PdfxBridge = {
  openPdfs: () => ipcRenderer.invoke('dialog:openPdfs'),
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  savePdf: (defaultName, bytes, extension) =>
    ipcRenderer.invoke('dialog:savePdf', defaultName, bytes, extension),
  convertOffice: () => ipcRenderer.invoke('convert:office'),
  runOcr: (bytes) => ipcRenderer.invoke('ocr:run', bytes),
  onOcrProgress: (cb) => {
    const handler = (_e: unknown, p: OcrProgress) => cb(p);
    ipcRenderer.on('ocr:progress', handler);
    return () => ipcRenderer.removeListener('ocr:progress', handler);
  },
};

contextBridge.exposeInMainWorld('pdfx', bridge);

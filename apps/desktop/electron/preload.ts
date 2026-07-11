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
  logError(message: string): void;
  recentList(): Promise<Array<{ path: string; name: string; openedAt: number }>>;
  recentAdd(entry: { path: string; name: string }): Promise<void>;
  recentOpen(path: string): Promise<OpenedFile | null>;
  onOcrProgress(cb: (p: OcrProgress) => void): () => void;
}

const bridge: PdfxBridge = {
  openPdfs: () => ipcRenderer.invoke('dialog:openPdfs'),
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  savePdf: (defaultName, bytes, extension) =>
    ipcRenderer.invoke('dialog:savePdf', defaultName, bytes, extension),
  convertOffice: () => ipcRenderer.invoke('convert:office'),
  runOcr: (bytes) => ipcRenderer.invoke('ocr:run', bytes),
  logError: (message: string) => ipcRenderer.send('log:error', message),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (entry) => ipcRenderer.invoke('recent:add', entry),
  recentOpen: (path) => ipcRenderer.invoke('recent:open', path),
  onOcrProgress: (cb) => {
    const handler = (_e: unknown, p: OcrProgress) => cb(p);
    ipcRenderer.on('ocr:progress', handler);
    return () => ipcRenderer.removeListener('ocr:progress', handler);
  },
};

contextBridge.exposeInMainWorld('pdfx', bridge);

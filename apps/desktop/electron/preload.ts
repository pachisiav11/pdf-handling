import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedFile {
  fileName: string;
  filePath: string;
  bytes: ArrayBuffer;
}

export interface PdfxBridge {
  openPdfs(): Promise<OpenedFile[]>;
  savePdf(defaultName: string, bytes: ArrayBuffer, extension?: string): Promise<string | null>;
}

const bridge: PdfxBridge = {
  openPdfs: () => ipcRenderer.invoke('dialog:openPdfs'),
  savePdf: (defaultName, bytes, extension) =>
    ipcRenderer.invoke('dialog:savePdf', defaultName, bytes, extension),
};

contextBridge.exposeInMainWorld('pdfx', bridge);

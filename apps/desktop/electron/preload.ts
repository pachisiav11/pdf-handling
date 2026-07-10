import { contextBridge, ipcRenderer } from 'electron';

export interface OpenedFile {
  filePath: string;
  bytes: ArrayBuffer;
}

contextBridge.exposeInMainWorld('pdfx', {
  openPdf: (): Promise<OpenedFile | null> => ipcRenderer.invoke('dialog:openPdf'),
});

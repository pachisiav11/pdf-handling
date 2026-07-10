import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#161A1E',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

interface OpenedFile {
  fileName: string;
  filePath: string;
  bytes: ArrayBuffer;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Native open dialog; multi-select. Returns file names, paths and bytes. */
ipcMain.handle('dialog:openPdfs', async (): Promise<OpenedFile[]> => {
  const result = await dialog.showOpenDialog({
    title: 'Open PDF',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  return Promise.all(
    result.filePaths.map(async (filePath) => ({
      fileName: basename(filePath),
      filePath,
      bytes: toArrayBuffer(await readFile(filePath)),
    })),
  );
});

/** Native save dialog + write. Returns the chosen path, or null if cancelled. */
ipcMain.handle(
  'dialog:savePdf',
  async (_e, defaultName: string, bytes: ArrayBuffer, extension?: string): Promise<string | null> => {
    const ext = extension ?? 'pdf';
    const result = await dialog.showSaveDialog({
      title: 'Save',
      defaultPath: defaultName,
      filters: [
        ext === 'zip'
          ? { name: 'Zip archive', extensions: ['zip'] }
          : { name: 'PDF document', extensions: ['pdf'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
  },
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { createNodeCanvasEncoder, ocrPdf, type OcrPageResult } from '@pdfx/core';
import { findSoffice, officeToPdf, OFFICE_EXTENSIONS } from '@pdfx/core/convert/officeConvert';

/** resources/ sits next to the app in dev; under process.resourcesPath when packaged. */
function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');
}

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
    const filterNames: Record<string, string> = {
      pdf: 'PDF document',
      zip: 'Zip archive',
      txt: 'Plain text',
      png: 'PNG image',
      jpg: 'JPEG image',
    };
    const result = await dialog.showSaveDialog({
      title: 'Save',
      defaultPath: defaultName,
      filters: [{ name: filterNames[ext] ?? ext.toUpperCase(), extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
  },
);

/** Office → PDF: pick an Office file, convert via bundled/system LibreOffice. */
ipcMain.handle('convert:office', async (): Promise<OpenedFile | { error: string } | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Convert Office document to PDF',
    filters: [{ name: 'Office documents', extensions: [...OFFICE_EXTENSIONS] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const inputPath = result.filePaths[0]!;
  try {
    const bundled = join(resourcesDir(), 'libreoffice', 'program', 'soffice.exe');
    const soffice = await findSoffice([bundled]);
    if (!soffice) {
      return {
        error:
          'Office conversion needs LibreOffice. Run "node scripts/fetch-binaries.mjs --office" (see README) or install LibreOffice, then try again.',
      };
    }
    const bytes = await officeToPdf(inputPath, { sofficePath: soffice });
    return {
      fileName: basename(inputPath).replace(/\.[^.]+$/, '.pdf'),
      filePath: inputPath,
      bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

/** OCR runs in the main process (Node): tesseract.js + local language data. */
ipcMain.handle('ocr:run', async (event, bytes: ArrayBuffer): Promise<OcrPageResult[] | { error: string }> => {
  try {
    const encoder = await createNodeCanvasEncoder();
    return await ocrPdf(
      new Uint8Array(bytes),
      {
        lang: 'eng',
        langPath: join(resourcesDir(), 'tesseract'),
        onProgress: (done, total) => event.sender.send('ocr:progress', { done, total }),
      },
      encoder,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

/** Pick images for image → PDF. */
ipcMain.handle('dialog:openImages', async (): Promise<OpenedFile[]> => {
  const result = await dialog.showOpenDialog({
    title: 'Choose images',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

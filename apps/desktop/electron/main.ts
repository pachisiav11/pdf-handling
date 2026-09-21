import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { createHmac } from 'crypto';
import { createNodeCanvasEncoder, ocrPdf, type OcrPageResult } from '@pdfx/core';
import { findSoffice, officeToPdf, OFFICE_EXTENSIONS } from '@pdfx/core/convert/officeConvert';

/** resources/ sits next to the app in dev; under process.resourcesPath when packaged. */
function resourcesDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources')
    : join(app.getAppPath(), 'resources');
}

const ILOVE_PDF_PUBLIC_KEY = 'project_public_3e6ebf6c7fe3800ecb67d9305ac66106_5TVOU661190bc6af1630f8f86d5ae8d465313';

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Development reads the ignored repository .env; a packaged app reads the
 * user-owned %APPDATA%/PDFX/iloveapi.json. Neither file is bundled or exposed
 * to the renderer.
 */
async function privateApiKey(): Promise<string> {
  const configFile = app.isPackaged
    ? join(app.getPath('userData'), 'iloveapi.json')
    : join(app.getAppPath(), '..', '..', '.env');
  let text: string;
  try {
    text = await readFile(configFile, 'utf8');
  } catch {
    throw new Error(
      app.isPackaged
        ? `Missing iLovePDF configuration. Create ${configFile} with a privateKey field.`
        : `Missing ${configFile}. Add ILOVEPDF_PRIVATE_KEY=your-key before starting the desktop app.`,
    );
  }
  if (app.isPackaged) {
    try {
      const parsed = JSON.parse(text) as { privateKey?: unknown };
      if (typeof parsed.privateKey === 'string' && parsed.privateKey.trim()) return parsed.privateKey.trim();
    } catch {
      // The message below gives the expected format without leaking contents.
    }
    throw new Error(
      `The iLovePDF private key in ${configFile} is missing or invalid. Expected JSON like {"privateKey": "your-key"}.`,
    );
  }
  const match = text.match(/^ILOVEPDF_PRIVATE_KEY\s*=\s*(.+)\s*$/m);
  if (match?.[1]) return match[1].trim().replace(/^['"]|['"]$/g, '');
  throw new Error(`ILOVEPDF_PRIVATE_KEY is missing or malformed in ${configFile}. Expected a line like ILOVEPDF_PRIVATE_KEY=your-key.`);
}

/** Creates a one-hour HS256 JWT with the claims required by iLovePDF. */
async function signedApiToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = base64Url(JSON.stringify({
    jti: ILOVE_PDF_PUBLIC_KEY,
    iss: 'api.ilovepdf.com',
    iat: now - 5,
    nbf: now - 5,
    exp: now + 55 * 60,
  }));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', await privateApiKey()).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

// ---- local-only error log (no network, ever) -------------------------------
// Rotating-ish: one file per day, plain text, under the OS log dir.
import { appendFile, mkdir } from 'fs/promises';

async function logLocal(kind: string, detail: string): Promise<void> {
  try {
    const dir = app.getPath('logs');
    await mkdir(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    await appendFile(
      join(dir, `pdfx-${day}.log`),
      `[${new Date().toISOString()}] ${kind}: ${detail}\n`,
    );
  } catch {
    // Logging must never crash the app.
  }
}

process.on('uncaughtException', (err) => void logLocal('uncaughtException', err.stack ?? String(err)));
process.on('unhandledRejection', (reason) => void logLocal('unhandledRejection', String(reason)));
ipcMain.on('log:error', (_e, message: string) => void logLocal('renderer', message));
ipcMain.handle('ilovepdf:token', () => signedApiToken());

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 600,
    show: false,
    backgroundColor: '#161A1E',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
        onProgress: (done, total) => {
          if (!event.sender.isDestroyed()) event.sender.send('ocr:progress', { done, total });
        },
      },
      encoder,
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ---- recent files (local JSON in userData; never leaves the device) --------
interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
}

const recentFile = () => join(app.getPath('userData'), 'recent.json');

ipcMain.handle('recent:list', async (): Promise<RecentEntry[]> => {
  try {
    return JSON.parse(await readFile(recentFile(), 'utf8')) as RecentEntry[];
  } catch {
    return [];
  }
});

ipcMain.handle('recent:add', async (_e, entry: { path: string; name: string }) => {
  let list: RecentEntry[] = [];
  try {
    list = JSON.parse(await readFile(recentFile(), 'utf8')) as RecentEntry[];
  } catch {
    /* first run */
  }
  list = [
    { ...entry, openedAt: Date.now() },
    ...list.filter((r) => r.path !== entry.path),
  ].slice(0, 10);
  await writeFile(recentFile(), JSON.stringify(list, null, 2));
});

ipcMain.handle('recent:open', async (_e, path: string): Promise<OpenedFile | null> => {
  try {
    return { fileName: basename(path), filePath: path, bytes: toArrayBuffer(await readFile(path)) };
  } catch {
    return null; // moved/deleted — renderer prunes it
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
}).catch((err) => {
  void logLocal('whenReady', err instanceof Error ? (err.stack ?? err.message) : String(err));
  dialog.showErrorBox('PDFX failed to start', err instanceof Error ? err.message : String(err));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

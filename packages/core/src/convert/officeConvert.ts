/**
 * Office → PDF via LibreOffice headless. DESKTOP-ONLY (Node): spawns a bundled
 * or system-installed soffice binary. Not exported from the package index so
 * mobile bundles never touch node builtins — import via
 * '@pdfx/core/convert/officeConvert'.
 */
import { PdfUserError } from '../load';

export const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'];

export interface OfficeConvertOptions {
  /** Explicit soffice binary path (e.g. the bundled one). Falls back to well-known locations. */
  sofficePath?: string;
  timeoutMs?: number;
}

/** Locate soffice: explicit path → env → bundled candidates → system installs → PATH. */
export async function findSoffice(candidates: string[] = []): Promise<string | null> {
  const { access } = await import('fs/promises');
  const { X_OK } = await import('fs').then((m) => m.constants);
  const all = [
    ...candidates,
    process.env['PDFX_SOFFICE'] ?? '',
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice',
    '/usr/local/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  ].filter(Boolean);
  for (const p of all) {
    try {
      await access(p, X_OK);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Convert an Office document (by path) to PDF bytes. */
export async function officeToPdf(
  inputPath: string,
  opts: OfficeConvertOptions = {},
): Promise<Uint8Array> {
  const soffice = opts.sofficePath ?? (await findSoffice());
  if (!soffice) {
    throw new PdfUserError(
      'Office conversion needs LibreOffice. Run the binary fetch script (see README) or install LibreOffice, then try again.',
      'unsupported',
    );
  }
  const { spawn } = await import('child_process');
  const { mkdtemp, readFile, rm, readdir } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const { join, basename } = await import('path');

  const outDir = await mkdtemp(join(tmpdir(), 'pdfx-office-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        soffice,
        ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, inputPath],
        { stdio: 'ignore', windowsHide: true },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new PdfUserError('LibreOffice took too long — conversion cancelled.', 'unsupported'));
      }, opts.timeoutMs ?? 120_000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new PdfUserError(`LibreOffice exited with code ${code} — the file may be unsupported or corrupt.`, 'unsupported'));
      });
    });
    const files = await readdir(outDir);
    const pdf = files.find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdf) {
      throw new PdfUserError(
        `LibreOffice did not produce a PDF for ${basename(inputPath)} — the format may be unsupported.`,
        'unsupported',
      );
    }
    return new Uint8Array(await readFile(join(outDir, pdf)));
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

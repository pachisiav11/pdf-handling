import { PDFDocument } from 'pdf-lib';

/** Error with a user-facing, actionable message (see build guide "Error handling"). */
export class PdfUserError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'password-protected'
      | 'corrupt'
      | 'invalid-range'
      | 'unsupported'
      | 'too-large',
  ) {
    super(message);
    this.name = 'PdfUserError';
  }
}

/** Load a PDF, mapping pdf-lib's raw errors to actionable user-facing ones. */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      ...(password ? { password } : {}),
    } as Parameters<typeof PDFDocument.load>[1]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypted/i.test(msg)) {
      throw new PdfUserError(
        'This PDF is password-protected — enter the password to continue.',
        'password-protected',
      );
    }
    throw new PdfUserError(
      'This file could not be read as a PDF. It may be corrupt or not a PDF at all.',
      'corrupt',
    );
  }
}

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdf(bytes);
  return doc.getPageCount();
}

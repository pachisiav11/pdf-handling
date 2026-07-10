import { loadPdf, PdfUserError } from '../load';
import type { Rect } from '../editing/types';

export interface NewFieldSpec {
  kind: 'text' | 'checkbox';
  name: string;
  pageIndex: number;
  rect: Rect; // PDF points, bottom-left origin
}

/** Create simple AcroForm fields (v1 scope: text field and checkbox). */
export async function createFormFields(
  bytes: Uint8Array,
  specs: NewFieldSpec[],
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  const existing = new Set(form.getFields().map((f) => f.getName()));
  for (const spec of specs) {
    if (existing.has(spec.name)) {
      throw new PdfUserError(
        `A field named "${spec.name}" already exists — field names must be unique.`,
        'unsupported',
      );
    }
    existing.add(spec.name);
    const page = doc.getPage(spec.pageIndex);
    if (spec.kind === 'text') {
      const field = form.createTextField(spec.name);
      field.addToPage(page, { ...spec.rect, borderWidth: 1 });
    } else {
      const field = form.createCheckBox(spec.name);
      field.addToPage(page, { ...spec.rect, borderWidth: 1 });
    }
  }
  form.updateFieldAppearances();
  return doc.save({ useObjectStreams: true });
}

import { describe, expect, it } from 'vitest';
import { fillFormFields, listFormFields } from '../src/forms/fill';
import { createFormFields } from '../src/forms/create';
import { loadPdf, PdfUserError } from '../src/load';
import { formPdf, textPdf } from './fixtures';
import { PDFCheckBox, PDFTextField } from 'pdf-lib';

describe('listFormFields', () => {
  it('detects fields with type, placement and editability', async () => {
    const fields = await listFormFields(await formPdf());
    expect(fields).toHaveLength(2);
    const name = fields.find((f) => f.name === 'applicant.name')!;
    expect(name.type).toBe('text');
    expect(name.editable).toBe(true);
    expect(name.pageIndex).toBe(0);
    expect(Math.abs(name.rect!.x - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(name.rect!.y - 700)).toBeLessThanOrEqual(1);
    const agree = fields.find((f) => f.name === 'applicant.agree')!;
    expect(agree.type).toBe('checkbox');
    expect(agree.value).toBe(false);
  });
});

describe('fillFormFields', () => {
  it('fills text + checkbox and the values persist standards-compliantly', async () => {
    const out = await fillFormFields(await formPdf(), [
      { name: 'applicant.name', value: 'Ada Lovelace' },
      { name: 'applicant.agree', value: true },
    ]);
    // Reload as a fresh document (what any third-party viewer does) and read values.
    const doc = await loadPdf(out);
    const form = doc.getForm();
    expect((form.getField('applicant.name') as PDFTextField).getText()).toBe('Ada Lovelace');
    expect((form.getField('applicant.agree') as PDFCheckBox).isChecked()).toBe(true);
  });

  it('errors actionably on unknown fields', async () => {
    await expect(
      fillFormFields(await formPdf(), [{ name: 'nope', value: 'x' }]),
    ).rejects.toThrowError(PdfUserError);
  });
});

describe('createFormFields', () => {
  it('creates a text field and checkbox that are then fillable', async () => {
    const withFields = await createFormFields(await textPdf(), [
      { kind: 'text', name: 'notes', pageIndex: 0, rect: { x: 60, y: 300, width: 240, height: 22 } },
      { kind: 'checkbox', name: 'done', pageIndex: 0, rect: { x: 60, y: 260, width: 16, height: 16 } },
    ]);
    const filled = await fillFormFields(withFields, [
      { name: 'notes', value: 'created then filled' },
      { name: 'done', value: true },
    ]);
    const fields = await listFormFields(filled);
    expect(fields.find((f) => f.name === 'notes')!.value).toBe('created then filled');
    expect(fields.find((f) => f.name === 'done')!.value).toBe(true);
  });

  it('rejects duplicate names', async () => {
    await expect(
      createFormFields(await formPdf(), [
        { kind: 'text', name: 'applicant.name', pageIndex: 0, rect: { x: 0, y: 0, width: 100, height: 20 } },
      ]),
    ).rejects.toThrowError(/already exists/);
  });
});

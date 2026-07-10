import {
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import { loadPdf, PdfUserError } from '../load';
import type { Rect } from '../editing/types';

export type FieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'option-list'
  | 'button'
  | 'signature'
  | 'unknown';

export interface FieldInfo {
  name: string;
  type: FieldType;
  /** Current value: string (text/dropdown/radio) or boolean (checkbox). */
  value: string | boolean | undefined;
  /** Editable by this app? Text and checkbox are supported in v1; the rest are listed read-only. */
  editable: boolean;
  readOnly: boolean;
  pageIndex: number | null;
  rect: Rect | null;
  options?: string[]; // dropdown/option-list/radio choices
}

/** Detect and list every AcroForm field with type, value, and placement. */
export async function listFormFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const form = doc.getForm();
  return form.getFields().map((field) => {
    let type: FieldType = 'unknown';
    let value: string | boolean | undefined;
    let options: string[] | undefined;
    if (field instanceof PDFTextField) {
      type = 'text';
      value = field.getText() ?? '';
    } else if (field instanceof PDFCheckBox) {
      type = 'checkbox';
      value = field.isChecked();
    } else if (field instanceof PDFRadioGroup) {
      type = 'radio';
      value = field.getSelected() ?? undefined;
      options = field.getOptions();
    } else if (field instanceof PDFDropdown) {
      type = 'dropdown';
      value = field.getSelected()[0];
      options = field.getOptions();
    } else if (field instanceof PDFOptionList) {
      type = 'option-list';
      value = field.getSelected()[0];
      options = field.getOptions();
    }

    let pageIndex: number | null = null;
    let rect: Rect | null = null;
    const widget = field.acroField.getWidgets()[0];
    if (widget) {
      const r = widget.getRectangle();
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      const pRef = widget.P();
      if (pRef) pageIndex = pages.findIndex((p) => p.ref === pRef);
      if (pageIndex === -1) pageIndex = null;
    }

    const editable = type === 'text' || type === 'checkbox';
    return {
      name: field.getName(),
      type,
      value,
      editable,
      readOnly: field.isReadOnly() || !editable,
      pageIndex,
      rect,
      options,
    };
  });
}

export interface FieldValue {
  name: string;
  value: string | boolean;
}

/** Fill text fields and checkboxes; regenerates appearances so values render everywhere. */
export async function fillFormFields(bytes: Uint8Array, values: FieldValue[]): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();
  for (const { name, value } of values) {
    const field = form.getFields().find((f) => f.getName() === name);
    if (!field) {
      throw new PdfUserError(`Form field "${name}" was not found in this document.`, 'unsupported');
    }
    if (field instanceof PDFTextField) {
      field.setText(String(value));
    } else if (field instanceof PDFCheckBox) {
      if (value) field.check();
      else field.uncheck();
    } else {
      throw new PdfUserError(
        `Field "${name}" is a type this app cannot edit yet — it stays unchanged.`,
        'unsupported',
      );
    }
  }
  form.updateFieldAppearances();
  return doc.save({ useObjectStreams: true });
}

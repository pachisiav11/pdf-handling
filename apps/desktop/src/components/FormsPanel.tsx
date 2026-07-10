import { useEffect, useState } from 'react';
import type { FieldInfo } from '@pdfx/core';
import { ops } from '../pdf/opsClient';
import { actions, type DocState } from '../state/store';

/** Side panel: detect AcroForm fields, edit the supported ones, apply. */
export function FormsPanel({ doc, onClose }: { doc: DocState; onClose: () => void }) {
  const [fields, setFields] = useState<FieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFields(null);
    ops
      .listFields(doc.bytes)
      .then((f) => {
        if (!alive) return;
        setFields(f);
        const init: Record<string, string | boolean> = {};
        for (const field of f) {
          if (field.editable && field.value !== undefined) init[field.name] = field.value;
        }
        setValues(init);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.version, doc.bytes]);

  const dirtyEntries = fields
    ? Object.entries(values).filter(([name, v]) => {
        const f = fields.find((x) => x.name === name);
        return f && f.editable && v !== (f.value ?? (f.type === 'checkbox' ? false : ''));
      })
    : [];

  const apply = async () => {
    await actions.fillFields(dirtyEntries.map(([name, value]) => ({ name, value })));
  };

  return (
    <div className="forms-panel">
      <div className="forms-head">
        <b>Form fields</b>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      {error && <p className="forms-empty">{error}</p>}
      {!error && fields === null && <p className="forms-empty">Reading fields…</p>}
      {fields !== null && fields.length === 0 && (
        <p className="forms-empty">
          This document has no form fields. Use the Field tool in the page view to add a text field
          or checkbox.
        </p>
      )}
      {fields !== null && fields.length > 0 && (
        <>
          <ul className="forms-list">
            {fields.map((f) => (
              <li key={f.name}>
                <label title={f.name}>
                  {f.name}
                  {f.pageIndex !== null && <span className="mono"> · p{f.pageIndex + 1}</span>}
                </label>
                {f.editable && f.type === 'text' && (
                  <input
                    className="input"
                    value={(values[f.name] as string) ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  />
                )}
                {f.editable && f.type === 'checkbox' && (
                  <input
                    type="checkbox"
                    checked={Boolean(values[f.name])}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                  />
                )}
                {!f.editable && (
                  <span className="forms-readonly">
                    {f.type} — not editable in this app{f.value ? ` (value: ${String(f.value)})` : ''}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="row" style={{ padding: '0 14px 14px' }}>
            <button className="btn primary" disabled={!dirtyEntries.length} onClick={() => void apply()}>
              Apply {dirtyEntries.length || ''} change{dirtyEntries.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

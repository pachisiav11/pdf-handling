import { useState } from 'react';
import { ping } from '@pdfx/core';

declare global {
  interface Window {
    pdfx: {
      openPdf(): Promise<{ filePath: string; bytes: ArrayBuffer } | null>;
    };
  }
}

export function App() {
  const [opened, setOpened] = useState<string | null>(null);

  const handleOpen = async () => {
    const file = await window.pdfx.openPdf();
    if (file) {
      setOpened(`${file.filePath} (${(file.bytes.byteLength / 1024).toFixed(1)} KB)`);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>PDFX</h1>
      <p>Shared core says: {ping()}</p>
      <button onClick={handleOpen}>Open a PDF…</button>
      {opened && <p>Opened: {opened}</p>}
    </div>
  );
}

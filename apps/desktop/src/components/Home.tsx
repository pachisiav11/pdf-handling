import { useState } from 'react';
import { openDroppedFiles, openViaDialog } from '../lib/files';

interface ToolDef {
  name: string;
  desc: string;
}

/* Every tool opens with file selection first — one click to the tool,
   the file dialog is the second. (≤2 clicks requirement.) */
const TOOLS: ToolDef[] = [
  { name: 'Organize pages', desc: 'Reorder, rotate, delete' },
  { name: 'Merge', desc: 'Combine PDFs into one' },
  { name: 'Split', desc: 'Extract a page range' },
  { name: 'Compress', desc: 'Shrink file size' },
  { name: 'View', desc: 'Read with zoom' },
];

export function Home() {
  const [over, setOver] = useState(false);

  return (
    <div
      className="home"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void openDroppedFiles(e.dataTransfer.files);
      }}
    >
      <div className="home-brand">
        <h1>
          PDF<span className="dot-c">X</span>
          <span className="dot-m">.</span>
          <span className="dot-y">.</span>
        </h1>
        <p>Every tool runs on this machine. Nothing is uploaded, ever.</p>
      </div>

      <button
        className={`dropzone cropmarks${over ? ' over' : ''}`}
        onClick={() => void openViaDialog()}
      >
        <strong>Drop PDFs here</strong>
        or click to browse files
      </button>

      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button key={t.name} className="tool-card cropmarks" onClick={() => void openViaDialog()}>
            <b>{t.name}</b>
            <span>{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

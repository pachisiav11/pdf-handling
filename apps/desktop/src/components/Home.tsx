import { useEffect, useState } from 'react';
import { openDroppedFiles, openRecent, openViaDialog } from '../lib/files';
import { imagesToPdfFlow, officeToPdfFlow } from '../lib/convert';
import { showNotice } from '../state/store';

interface ToolDef {
  name: string;
  desc: string;
  action?: () => void;
}

/* Every tool opens with file selection first — one click to the tool,
   the file dialog is the second. (≤2 clicks requirement.) */
const TOOLS: ToolDef[] = [
  { name: 'Organize pages', desc: 'Reorder, rotate, delete' },
  { name: 'Merge', desc: 'Combine PDFs into one' },
  { name: 'Split', desc: 'Extract a page range' },
  { name: 'Compress', desc: 'Shrink file size' },
  { name: 'Images → PDF', desc: 'JPG/PNG to pages', action: () => void imagesToPdfFlow() },
  { name: 'Office → PDF', desc: 'Word, Excel, PowerPoint', action: () => void officeToPdfFlow() },
];

export function Home() {
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState<Array<{ path: string; name: string; openedAt: number }>>([]);

  useEffect(() => {
    window.pdfx.recentList?.().then(setRecent).catch(() => undefined);
  }, []);

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
          <button
            key={t.name}
            className="tool-card cropmarks"
            onClick={t.action ?? (() => void openViaDialog())}
          >
            <b>{t.name}</b>
            <span>{t.desc}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <span className="recent-label mono">Recent</span>
          {recent.slice(0, 5).map((r) => (
            <button
              key={r.path}
              className="recent-item"
              title={r.path}
              onClick={async () => {
                const ok = await openRecent(r.path);
                if (!ok) {
                  setRecent((cur) => cur.filter((x) => x.path !== r.path));
                  showNotice(`${r.name} has moved or been deleted — removed from recents.`);
                }
              }}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

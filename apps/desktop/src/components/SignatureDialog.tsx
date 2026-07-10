import { useEffect, useRef, useState } from 'react';
import '@fontsource/caveat/600.css';
import { requestStampPlacement } from '../state/store';

type Tab = 'draw' | 'type' | 'upload';
type Slot = 'signature' | 'initials';

const STORAGE_KEY = (slot: Slot) => `pdfx.saved-${slot}`; // dataURL PNG, local only

function loadSaved(slot: Slot): string | null {
  return localStorage.getItem(STORAGE_KEY(slot));
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  // No fetch(data:) — the app CSP is default-src 'self'. Decode base64 directly.
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Signature/initials capture: draw on a pad, type in a handwriting font, or
    upload an image. The result is placed via the viewer's stamp mode and the
    last-used image is kept locally (never leaves the device). */
export function SignatureDialog({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('draw');
  const [typed, setTyped] = useState('');
  const [uploaded, setUploaded] = useState<string | null>(null);
  const saved = loadSaved(slot);
  const padRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    const canvas = padRef.current;
    if (!canvas || tab !== 'draw') return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#101418';
    hasInk.current = false;
  }, [tab]);

  const padPoint = (e: React.PointerEvent) => {
    const rect = padRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * padRef.current!.width,
      y: ((e.clientY - rect.top) / rect.height) * padRef.current!.height,
    };
  };

  const finish = (dataUrl: string) => {
    localStorage.setItem(STORAGE_KEY(slot), dataUrl);
    requestStampPlacement(dataUrlToBytes(dataUrl), slot);
    onClose();
  };

  const useDrawn = () => {
    if (!hasInk.current) return;
    void finish(trimmedPng(padRef.current!));
  };

  const useTyped = () => {
    if (!typed.trim()) return;
    const canvas = document.createElement('canvas');
    const size = slot === 'signature' ? 96 : 120;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `600 ${size}px Caveat`;
    canvas.width = Math.ceil(ctx.measureText(typed).width) + 40;
    canvas.height = size * 1.6;
    const ctx2 = canvas.getContext('2d')!;
    ctx2.font = `600 ${size}px Caveat`;
    ctx2.fillStyle = '#101418';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(typed, 20, canvas.height / 2);
    void finish(canvas.toDataURL('image/png'));
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog cropmarks" onClick={(e) => e.stopPropagation()}>
        <h2>{slot === 'signature' ? 'Sign' : 'Initials'}</h2>
        <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
          {(['draw', 'type', 'upload'] as const).map((t) => (
            <button key={t} className={`btn${tab === t ? ' primary' : ''}`} onClick={() => setTab(t)}>
              {t === 'draw' ? 'Draw' : t === 'type' ? 'Type' : 'Upload'}
            </button>
          ))}
          {saved && (
            <button
              className="btn"
              style={{ marginLeft: 'auto' }}
              onClick={() => void finish(saved)}
              title="Reuse your last saved one"
            >
              Use saved
            </button>
          )}
        </div>

        {tab === 'draw' && (
          <>
            <canvas
              ref={padRef}
              width={560}
              height={200}
              className="sig-pad"
              onPointerDown={(e) => {
                drawing.current = true;
                hasInk.current = true;
                const p = padPoint(e);
                const ctx = padRef.current!.getContext('2d')!;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const p = padPoint(e);
                const ctx = padRef.current!.getContext('2d')!;
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
              }}
              onPointerUp={() => (drawing.current = false)}
            />
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  const c = padRef.current!;
                  c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
                  hasInk.current = false;
                }}
              >
                Clear
              </button>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" onClick={useDrawn}>Place on page</button>
            </div>
          </>
        )}

        {tab === 'type' && (
          <>
            <input
              className="input"
              placeholder={slot === 'signature' ? 'Your name' : 'Your initials'}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
            <div className="sig-preview" style={{ fontFamily: 'Caveat', fontSize: 44 }}>
              {typed || ' '}
            </div>
            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!typed.trim()} onClick={useTyped}>
                Place on page
              </button>
            </div>
          </>
        )}

        {tab === 'upload' && (
          <>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => setUploaded(reader.result as string);
                reader.readAsDataURL(f);
              }}
            />
            {uploaded && (
              <div className="sig-preview">
                <img src={uploaded} alt="Uploaded signature" style={{ maxHeight: 120 }} />
              </div>
            )}
            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!uploaded} onClick={() => uploaded && void finish(uploaded)}>
                Place on page
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Trim transparent margins so the placed stamp hugs the ink. */
function trimmedPng(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas.toDataURL('image/png');
  const pad = 6;
  const out = document.createElement('canvas');
  out.width = maxX - minX + pad * 2;
  out.height = maxY - minY + pad * 2;
  out.getContext('2d')!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

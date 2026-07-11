/** Generates the PDFX app icon (desktop .ico + PNGs; Android reuses the same mark in Phase 7).
    Design: prepress identity — dark graphite tile, paper-white sheet with registration
    crop marks, CMY ink dots. Pure code, no design assets needed. */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(root, 'packages', 'core', 'package.json'));
const { createCanvas } = req('@napi-rs/canvas');

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const u = size / 512; // design units at 512

  // graphite tile with subtle rounding
  const r = 96 * u;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#161A1E';
  ctx.fill();

  // paper sheet, slightly rotated
  const sw = 268 * u;
  const sh = 348 * u;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-0.06);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 26 * u;
  ctx.shadowOffsetY = 10 * u;
  ctx.fillStyle = '#F6F4EE';
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  ctx.shadowColor = 'transparent';

  // faint text lines on the sheet
  ctx.fillStyle = '#C9C5BA';
  const lineW = sw * 0.66;
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(-sw / 2 + sw * 0.17, -sh / 2 + sh * (0.2 + i * 0.11), i === 0 ? lineW * 0.6 : lineW, 8 * u);
  }

  // CMY ink dots bottom-right of the sheet
  const dotR = 17 * u;
  const dy = sh / 2 - 40 * u;
  const colors = ['#29B6E8', '#E64980', '#FFD400'];
  colors.forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(-sw / 2 + sw * (0.3 + i * 0.2), dy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
  ctx.restore();

  // registration crop marks at the tile corners (cyan)
  ctx.strokeStyle = '#29B6E8';
  ctx.lineWidth = Math.max(2, 10 * u);
  const m = 56 * u;
  const len = 52 * u;
  const corners = [
    [m, m, 1, 1],
    [size - m, m, -1, 1],
    [m, size - m, 1, -1],
    [size - m, size - m, -1, -1],
  ];
  for (const [x, y, dx, dyy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * dx, y);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len * dyy);
    ctx.stroke();
  }
  return c;
}

/** Build a .ico containing PNG-compressed entries (valid for Vista+). */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  const blobs = [];
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e); // width (0 = 256)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    header.writeUInt8(0, e + 2); // palette
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
    blobs.push(data);
  });
  return Buffer.concat([header, ...blobs]);
}

const buildDir = join(root, 'apps', 'desktop', 'build');
await mkdir(buildDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ size: s, data: drawIcon(s).toBuffer('image/png') }));
await writeFile(join(buildDir, 'icon.ico'), buildIco(pngs));
await writeFile(join(buildDir, 'icon.png'), drawIcon(512).toBuffer('image/png'));
await writeFile(join(buildDir, 'icon-1024.png'), drawIcon(1024).toBuffer('image/png'));
console.log('icons written to', buildDir);

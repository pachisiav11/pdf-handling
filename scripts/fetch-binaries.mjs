#!/usr/bin/env node
/**
 * Downloads the large offline helper binaries that are NOT committed to git
 * (see README "Native binaries"). Run once after cloning:
 *
 *   node scripts/fetch-binaries.mjs            # tesseract data (small, always)
 *   node scripts/fetch-binaries.mjs --office   # + LibreOffice (~350MB, Windows)
 *   node scripts/fetch-binaries.mjs --gs       # + Ghostscript (Windows)
 *
 * Everything lands under apps/desktop/resources/ (gitignored). The app also
 * falls back to system-installed LibreOffice/Ghostscript if present.
 */
import { createWriteStream } from 'fs';
import { mkdir, access, rename } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resources = join(root, 'apps', 'desktop', 'resources');
const args = process.argv.slice(2);
const run = promisify(execFile);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest, label) {
  if (await exists(dest)) {
    console.log(`✓ ${label} already present (${dest})`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  console.log(`↓ ${label}\n  ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const tmp = dest + '.part';
  await pipeline(res.body, createWriteStream(tmp));
  await rename(tmp, dest);
  console.log(`✓ ${label} done`);
}

// 1. Tesseract English language pack (tessdata_fast, gzip kept — tesseract.js reads .gz)
await download(
  'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata',
  join(resources, 'tesseract', 'eng.traineddata'),
  'Tesseract eng.traineddata (~4MB)',
);

// 2. LibreOffice (Windows x64 MSI, extracted via administrative install — no admin rights needed)
if (args.includes('--office')) {
  const version = '25.8.5.2';
  const msi = join(resources, `LibreOffice_${version}_Win_x86-64.msi`);
  const target = join(resources, 'libreoffice');
  if (await exists(join(target, 'program', 'soffice.exe'))) {
    console.log('✓ LibreOffice already extracted');
  } else {
    await download(
      `https://downloadarchive.documentfoundation.org/libreoffice/old/${version}/win/x86_64/LibreOffice_${version}_Win_x86-64.msi`,
      msi,
      `LibreOffice ${version} MSI (~350MB)`,
    );
    console.log('… extracting MSI (msiexec /a)');
    await mkdir(target, { recursive: true });
    await run('msiexec', ['/a', msi, '/qn', `TARGETDIR=${target}`]);
    console.log('✓ LibreOffice extracted to', target);
  }
}

// 3. Ghostscript (Windows x64) — used for the High compression preset when present
if (args.includes('--gs')) {
  const gsVersion = '10.04.0';
  await download(
    `https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10040/gs${gsVersion.replaceAll('.', '')}w64.exe`,
    join(resources, 'ghostscript', `gs-installer.exe`),
    `Ghostscript ${gsVersion} installer`,
  );
  console.log('  → run the installer with /S /D=<resources>\\ghostscript to place it locally, or install system-wide.');
}

console.log('\nAll requested binaries handled.');

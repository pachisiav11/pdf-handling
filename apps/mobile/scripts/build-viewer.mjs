// Bundles the pdf.js viewer page used by the Android WebViews.
// Usage: node scripts/build-viewer.mjs <output dir>
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? join(root, 'build', 'viewer'));
const pdfjsDir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const common = { bundle: true, format: 'iife', target: 'chrome80', minify: true, logLevel: 'warning' };

// The worker is inlined as text so the page can start it from a Blob (file://
// pages cannot load workers by URL) or run it in-page as a fallback.
const worker = await build({ ...common, entryPoints: [join(root, 'viewer', 'worker.ts')], write: false });
const workerSource = worker.outputFiles[0].text;

mkdirSync(out, { recursive: true });
await build({
  ...common,
  entryPoints: [join(root, 'viewer', 'viewer.ts')],
  outfile: join(out, 'viewer.js'),
  plugins: [
    {
      name: 'worker-source',
      setup(b) {
        b.onResolve({ filter: /^pdfx:worker-source$/ }, (a) => ({ path: a.path, namespace: 'pdfx' }));
        b.onLoad({ filter: /.*/, namespace: 'pdfx' }, () => ({ contents: workerSource, loader: 'text' }));
      },
    },
  ],
});
cpSync(join(root, 'viewer', 'index.html'), join(out, 'index.html'));
cpSync(join(pdfjsDir, 'cmaps'), join(out, 'cmaps'), { recursive: true });
cpSync(join(pdfjsDir, 'standard_fonts'), join(out, 'standard_fonts'), { recursive: true });
console.log(`pdf.js viewer built to ${out}`);

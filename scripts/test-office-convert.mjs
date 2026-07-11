/** Manual Phase 5 acceptance: build a real .docx, convert via bundled LibreOffice
    (same soffice invocation as core/convert/officeConvert.ts), verify the PDF. */
import { createRequire } from 'module';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// fflate lives in the core package's node_modules (pnpm isolated layout)
const req = createRequire(join(root, 'packages', 'core', 'package.json'));
const { zipSync, strToU8 } = req('fflate');
const tmp = join(root, 'scripts', '.tmp');
await mkdir(tmp, { recursive: true });

const docx = zipSync({
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
  'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>PDFX OFFICE CONVERSION TEST HEADING</w:t></w:r></w:p>
    <w:p><w:r><w:t>This paragraph proves Word to PDF conversion works offline via bundled LibreOffice.</w:t></w:r></w:p>
  </w:body>
</w:document>`),
});
const docxPath = join(tmp, 'sample.docx');
await writeFile(docxPath, docx);
console.log('docx written:', docxPath);

const soffice = join(root, 'apps', 'desktop', 'resources', 'libreoffice', 'program', 'soffice.exe');
const run = promisify(execFile);
const t0 = Date.now();
await run(soffice, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', tmp, docxPath]);
console.log(`converted in ${Date.now() - t0}ms`);

const files = await readdir(tmp);
const pdfName = files.find((f) => f.endsWith('.pdf'));
const pdf = await readFile(join(tmp, pdfName));
console.log('pdf size:', pdf.length, 'bytes; header:', pdf.subarray(0, 5).toString());
if (!pdf.subarray(0, 5).toString().startsWith('%PDF-')) throw new Error('Not a PDF!');
console.log('OK — Office → PDF works with the bundled LibreOffice.');

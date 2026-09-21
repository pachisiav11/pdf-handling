import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerSource from 'pdfx:worker-source';

/**
 * pdf.js page for the Android app's WebViews. Two modes (window.PDFX_MODE):
 *   view   – scrolling, pinch-zoomable reader.
 *   thumbs – hidden renderer that answers thumbnail requests with JPEG data URLs.
 * React Native sends messages by calling window.pdfxReceive(msg); the page
 * answers through window.ReactNativeWebView.postMessage(JSON).
 */

type Incoming =
  | { type: 'load'; url: string; key: string; page?: number }
  | { type: 'thumb'; key: string; page: number; width: number }
  | { type: 'goto'; page: number };

type Outgoing =
  | { type: 'ready' }
  | { type: 'loaded'; key: string; pageCount: number }
  | { type: 'thumb'; key: string; page: number; dataUrl: string }
  | { type: 'error'; key?: string; message: string };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    pdfxReceive(msg: Incoming): void;
    PDFX_MODE?: string;
  }
}

// The app sets PDFX_MODE before the page loads; ?mode= is for testing in a browser.
const mode =
  (window.PDFX_MODE ?? new URLSearchParams(location.search).get('mode')) === 'thumbs' ? 'thumbs' : 'view';
const dpr = Math.min(window.devicePixelRatio || 1, 3);

// pdf.js paces rendering with requestAnimationFrame, which never fires in the
// hidden thumbnail WebView.
if (mode === 'thumbs') window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);

function post(msg: Outgoing): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Real worker from a Blob when the WebView allows it; otherwise run pdf.js in-page. */
function startWorker(): Promise<void> {
  const runInPage = () => {
    const script = document.createElement('script');
    script.textContent = workerSource;
    document.head.appendChild(script);
  };
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
    } catch {
      runInPage();
      resolve();
      return;
    }
    const fail = () => {
      clearTimeout(timer);
      worker.terminate();
      runInPage();
      resolve();
    };
    const timer = setTimeout(fail, 5000);
    worker.onerror = fail;
    const onReady = (e: MessageEvent) => {
      if ((e.data as { action?: string } | null)?.action !== 'ready') return;
      clearTimeout(timer);
      worker.onerror = null;
      worker.removeEventListener('message', onReady);
      pdfjs.GlobalWorkerOptions.workerPort = worker;
      resolve();
    };
    worker.addEventListener('message', onReady);
  });
}

function readFile(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    // file:// answers with status 0 on success.
    xhr.onload = () =>
      xhr.response && (xhr.status === 0 || xhr.status === 200)
        ? resolve(new Uint8Array(xhr.response as ArrayBuffer))
        : reject(new Error(`Could not read the PDF (status ${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Could not read the PDF.'));
    xhr.send();
  });
}

let doc: PDFDocumentProxy | null = null;
let docKey = '';

async function openDocument(url: string, key: string): Promise<PDFDocumentProxy> {
  const data = await readFile(url);
  const next = await pdfjs.getDocument({
    data,
    cMapUrl: 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'standard_fonts/',
    isEvalSupported: false,
  }).promise;
  const previous = doc;
  doc = next;
  docKey = key;
  void previous?.destroy();
  return next;
}

// ---------------------------------------------------------------- thumbs mode

interface ThumbJob {
  key: string;
  page: number;
  width: number;
}
const jobs: ThumbJob[] = [];
let thumbBusy = false;

async function pumpThumbs(): Promise<void> {
  if (thumbBusy) return;
  thumbBusy = true;
  try {
    // Newest request first: those are the cells the user is looking at now.
    for (let job = jobs.pop(); job; job = jobs.pop()) {
      if (!doc || job.key !== docKey) continue;
      try {
        const page = await doc.getPage(job.page + 1);
        const canvas = document.createElement('canvas');
        await renderInto(page, canvas, job.width);
        post({ type: 'thumb', key: job.key, page: job.page, dataUrl: canvas.toDataURL('image/jpeg', 0.75) });
        page.cleanup();
      } catch (err) {
        if (job.key === docKey) post({ type: 'error', key: job.key, message: errorText(err) });
      }
    }
  } finally {
    thumbBusy = false;
  }
}

function renderInto(page: PDFPageProxy, canvas: HTMLCanvasElement, pixelWidth: number): Promise<void> {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: pixelWidth / base.width });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return page.render({ canvasContext: ctx, viewport }).promise;
}

// ------------------------------------------------------------------ view mode

const MAX_CANVAS_PIXELS = 4096 * 4096;
const pagesEl = document.getElementById('pages')!;
const indicator = document.getElementById('indicator')!;

interface Slot {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  renderedWidth: number;
  task: RenderTask | null;
  near: boolean;
}
let slots: Slot[] = [];
let observer: IntersectionObserver | null = null;
let indicatorTimer: ReturnType<typeof setTimeout> | undefined;

function zoom(): number {
  return window.visualViewport?.scale ?? 1;
}

function targetWidth(slot: Slot): number {
  const cssWidth = slot.el.clientWidth || window.innerWidth;
  const aspect = slot.el.clientHeight / Math.max(1, cssWidth) || 1.3;
  let width = cssWidth * dpr * Math.min(zoom(), 4);
  if (width * width * aspect > MAX_CANVAS_PIXELS) width = Math.sqrt(MAX_CANVAS_PIXELS / aspect);
  return Math.round(width);
}

async function renderSlot(index: number): Promise<void> {
  const slot = slots[index];
  if (!slot || !doc || !slot.near) return;
  const width = targetWidth(slot);
  if (slot.canvas && Math.abs(slot.renderedWidth - width) < 2) return;
  slot.task?.cancel();
  const current = doc;
  const page = await current.getPage(index + 1);
  if (current !== doc || !slot.near) return;
  const base = page.getViewport({ scale: 1 });
  slot.el.style.aspectRatio = `${base.width} / ${base.height}`;
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
  slot.task = task;
  try {
    await task.promise;
  } catch {
    return; // cancelled by a newer render or by scrolling away
  } finally {
    if (slot.task === task) slot.task = null;
  }
  if (current !== doc || !slot.near) return;
  slot.canvas?.remove();
  slot.el.appendChild(canvas);
  slot.canvas = canvas;
  slot.renderedWidth = width;
}

function releaseSlot(slot: Slot): void {
  slot.task?.cancel();
  slot.task = null;
  if (slot.canvas) {
    slot.canvas.width = 0; // frees the backing store right away
    slot.canvas.remove();
    slot.canvas = null;
  }
  slot.renderedWidth = 0;
}

function currentPage(): number {
  const mid = window.innerHeight / 2;
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i]!.el.getBoundingClientRect();
    if (r.bottom >= mid) return i;
  }
  return slots.length - 1;
}

function showIndicator(): void {
  if (!slots.length) return;
  indicator.textContent = `${currentPage() + 1} / ${slots.length}`;
  indicator.classList.remove('hidden');
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => indicator.classList.add('hidden'), 1200);
}

async function showDocument(d: PDFDocumentProxy, startPage: number): Promise<void> {
  observer?.disconnect();
  for (const slot of slots) releaseSlot(slot);
  pagesEl.textContent = '';
  const first = (await d.getPage(1)).getViewport({ scale: 1 });
  slots = Array.from({ length: d.numPages }, () => {
    const el = document.createElement('div');
    el.className = 'page';
    el.style.aspectRatio = `${first.width} / ${first.height}`;
    pagesEl.appendChild(el);
    return { el, canvas: null, renderedWidth: 0, task: null, near: false };
  });
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const index = slots.findIndex((s) => s.el === entry.target);
        const slot = slots[index];
        if (!slot) continue;
        slot.near = entry.isIntersecting;
        if (slot.near) void renderSlot(index);
        else releaseSlot(slot);
      }
    },
    { rootMargin: '150% 0px' },
  );
  for (const slot of slots) observer.observe(slot.el);
  goto(startPage);
}

function goto(page: number): void {
  const slot = slots[Math.max(0, Math.min(page, slots.length - 1))];
  slot?.el.scrollIntoView({ block: 'start' });
  showIndicator();
}

function showMessage(text: string): void {
  pagesEl.textContent = '';
  const el = document.createElement('div');
  el.id = 'message';
  el.textContent = text;
  pagesEl.appendChild(el);
}

if (mode === 'view') {
  window.addEventListener('scroll', showIndicator, { passive: true });
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  // Pinch zoom stretches the canvases; re-render the visible pages sharply once it settles.
  window.visualViewport?.addEventListener('resize', () => {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => slots.forEach((_, i) => void renderSlot(i)), 250);
  });
}

// ------------------------------------------------------------------- messages

const ready = startWorker();
// Handled in arrival order, so thumbnail requests sent right after a load wait for it.
let queue: Promise<void> = ready;

window.pdfxReceive = (msg: Incoming) => {
  queue = queue.then(async () => {
    switch (msg.type) {
      case 'load':
        try {
          const d = await openDocument(msg.url, msg.key);
          if (mode === 'view') await showDocument(d, msg.page ?? 0);
          post({ type: 'loaded', key: msg.key, pageCount: d.numPages });
        } catch (err) {
          if (mode === 'view') showMessage(`This PDF could not be displayed: ${errorText(err)}`);
          post({ type: 'error', key: msg.key, message: errorText(err) });
        }
        break;
      case 'thumb':
        jobs.push(msg);
        void pumpThumbs();
        break;
      case 'goto':
        goto(msg.page);
        break;
    }
  });
};

void ready.then(() => post({ type: 'ready' }));

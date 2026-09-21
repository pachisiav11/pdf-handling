/**
 * Small, dependency-free iLovePDF REST client intended for browser, Electron
 * renderer, and React Native runtimes. It deliberately accepts a token provider
 * so no private key is ever included in shipped client code.
 */
export type ILovePdfTool =
  | 'compress'
  | 'extract'
  | 'imagepdf'
  | 'merge'
  | 'officepdf'
  | 'pagenumber'
  | 'pdfjpg'
  | 'pdfocr'
  | 'rotate'
  | 'split'
  | 'watermark';

export type ILovePdfRegion = 'eu' | 'us' | 'fr' | 'de' | 'pl' | 'in' | 'sg';

export interface ApiFile {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
  /** Applied by iLovePDF before the requested operation. */
  rotate?: 0 | 90 | 180 | 270;
}

export interface ILovePdfClientOptions {
  publicKey: string;
  region?: ILovePdfRegion;
  /**
   * Returns a short-lived JWT. Use a secure server-side signer for production.
   * Return a nullish value (or omit the provider) to use iLovePDF's documented
   * public-key /auth endpoint instead.
   */
  tokenProvider?: () => Promise<string | null | undefined>;
  fetch?: typeof globalThis.fetch;
  /** Abort a single HTTP call after this many milliseconds. Default two minutes. */
  timeoutMs?: number;
}

/** Outcome of one task, including whether iLovePDF packaged several files. */
export interface ProcessResult {
  bytes: Uint8Array;
  /** Name iLovePDF gave the download. Ends in .zip when several files are packaged. */
  filename: string;
  /** Number of output files the download holds. */
  fileCount: number;
  /** True when `bytes` is a ZIP archive rather than a single output file. */
  archive: boolean;
}

interface StartResponse {
  server: string;
  task: string;
  remaining_credits?: number;
}

interface UploadResponse {
  server_filename: string;
}

interface TaskResponse {
  status?: string;
  status_message?: string;
  download_filename?: string;
  output_filenumber?: number;
  output_extensions?: string | string[];
}

const MULTIPART_BOUNDARY = '----pdfxILovePdfFormBoundary';
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const MAX_ATTEMPTS = 3;
const PENDING_STATUSES = ['TaskWaiting', 'TaskProcessing'];
const MAX_POLLS = 20;
const MESSAGE_KEYS = ['type', 'message', 'status_message', 'error', 'reason'];

export class ILovePdfError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ILovePdfError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * iLovePDF nests failures, e.g. `{"error":{"type":"ProcessingError","message":…,
 * "param":{"files":[{"error":…}]}}}`, so walk the envelope instead of reading
 * top-level strings only.
 */
function collectMessages(value: unknown, depth: number, found: string[]): void {
  if (!value || typeof value !== 'object' || depth > 5 || found.length >= 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectMessages(item, depth + 1, found);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') {
      if (item && MESSAGE_KEYS.includes(key) && !found.includes(item)) found.push(item);
    } else {
      collectMessages(item, depth + 1, found);
    }
  }
}

function jsonError(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined;
  const found: string[] = [];
  collectMessages(value, 0, found);
  return found.length ? found.join(': ') : undefined;
}

async function responseError(response: Response): Promise<ILovePdfError> {
  const raw = await response.text();
  let message: string | undefined;
  try {
    message = jsonError(JSON.parse(raw) as unknown);
  } catch {
    message = raw.trim() || undefined;
  }
  return new ILovePdfError(message ?? `iLovePDF request failed (${response.status})`, response.status);
}

interface FormPart {
  name: string;
  value?: string;
  filename?: string;
  contentType?: string;
  bytes?: Uint8Array;
}

function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Builds the multipart body by hand. React Native's Blob refuses typed-array
 * parts and its FormData drops the filename argument, so neither is usable here.
 */
function multipart(parts: FormPart[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let header = `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${headerSafe(part.name)}"`;
    if (part.filename !== undefined) header += `; filename="${headerSafe(part.filename)}"`;
    header += '\r\n';
    if (part.contentType) header += `Content-Type: ${headerSafe(part.contentType)}\r\n`;
    chunks.push(ascii(`${header}\r\n`));
    chunks.push(part.bytes ?? ascii(part.value ?? ''));
    chunks.push(ascii('\r\n'));
  }
  chunks.push(ascii(`--${MULTIPART_BOUNDARY}--\r\n`));

  const body = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/** Execute one iLovePDF task: authenticate, start, upload, process, download. */
export class ILovePdfClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly region: ILovePdfRegion;
  private readonly timeoutMs: number;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(private readonly options: ILovePdfClientOptions) {
    if (!options.publicKey) throw new Error('An iLovePDF public key is required.');
    // Unbound globalThis.fetch throws "Illegal invocation" when called as a method.
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.region = options.region ?? 'in';
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async token(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) return this.cachedToken.value;
    if (!this.pendingToken) {
      this.pendingToken = this.requestToken().finally(() => {
        this.pendingToken = null;
      });
    }
    return this.pendingToken;
  }

  private async requestToken(): Promise<string> {
    let token = this.options.tokenProvider ? await this.options.tokenProvider() : undefined;
    if (!token) {
      const response = await this.request('https://api.ilovepdf.com/v1/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_key: this.options.publicKey }),
      });
      const data = (await response.json()) as { token?: string };
      if (!data.token) throw new ILovePdfError('iLovePDF did not return an authorization token.');
      token = data.token;
    }
    // Tokens expire in one hour; refresh five minutes early.
    this.cachedToken = { value: token, expiresAt: Date.now() + 55 * 60 * 1000 };
    return token;
  }

  private async request(url: string, init: RequestInit, attempt = 1): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ILovePdfError(`iLovePDF did not answer within ${this.timeoutMs} ms.`);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      if (RETRY_STATUSES.includes(response.status) && attempt < MAX_ATTEMPTS) {
        await delay(600 * 2 ** (attempt - 1));
        return this.request(url, init, attempt + 1);
      }
      throw await responseError(response);
    }
    return response;
  }

  private async authorized(url: string, init: RequestInit = {}, reauthenticate = true): Promise<Response> {
    const token = await this.token();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    try {
      return await this.request(url, { ...init, headers });
    } catch (error) {
      if (reauthenticate && error instanceof ILovePdfError && error.status === 401) {
        this.cachedToken = null;
        return this.authorized(url, init, false);
      }
      throw error;
    }
  }

  async process(tool: ILovePdfTool, files: ApiFile[], parameters: Record<string, unknown> = {}): Promise<Uint8Array> {
    const result = await this.processDetailed(tool, files, parameters);
    return result.bytes;
  }

  /** Like `process`, but also reports whether the download is a packaged archive. */
  async processDetailed(
    tool: ILovePdfTool,
    files: ApiFile[],
    parameters: Record<string, unknown> = {},
  ): Promise<ProcessResult> {
    if (!files.length) throw new ILovePdfError('Choose at least one file.');
    const start = await this.authorized(`https://api.ilovepdf.com/v1/start/${tool}/${this.region}`);
    const task = (await start.json()) as StartResponse;
    if (!task.server || !task.task) throw new ILovePdfError('iLovePDF returned an invalid task response.');

    const uploaded = await Promise.all(files.map(async (file) => {
      const upload = await this.authorized(`https://${task.server}/v1/upload`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}` },
        // Cast: the DOM and React Native body types disagree about typed arrays.
        body: multipart([
          { name: 'task', value: task.task },
          {
            name: 'file',
            filename: file.name,
            contentType: file.mimeType ?? 'application/pdf',
            bytes: file.bytes,
          },
        ]) as unknown as RequestInit['body'],
      });
      const result = (await upload.json()) as UploadResponse;
      if (!result.server_filename) throw new ILovePdfError(`iLovePDF did not accept ${file.name}.`);
      return { server_filename: result.server_filename, filename: file.name, rotate: file.rotate ?? 0 };
    }));

    const process = await this.authorized(`https://${task.server}/v1/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task.task, tool, files: uploaded, ...parameters }),
    });
    let result = (await process.json()) as TaskResponse;

    // /process answers synchronously unless a webhook is set, but the task can
    // still come back queued; poll the task resource until it settles.
    for (let poll = 0; result.status && PENDING_STATUSES.includes(result.status) && poll < MAX_POLLS; poll += 1) {
      await delay(1_000);
      const status = await this.authorized(`https://${task.server}/v1/task/${task.task}`);
      result = (await status.json()) as TaskResponse;
    }
    if (result.status && !result.status.startsWith('TaskSuccess')) {
      throw new ILovePdfError(result.status_message ?? `iLovePDF task did not complete: ${result.status}`);
    }

    const download = await this.authorized(`https://${task.server}/v1/download/${task.task}`);
    const bytes = new Uint8Array(await download.arrayBuffer());
    const filename = result.download_filename ?? `${tool}-output.pdf`;
    const fileCount = result.output_filenumber ?? 1;
    return { bytes, filename, fileCount, archive: fileCount > 1 || /\.zip$/i.test(filename) };
  }
}

export function createILovePdfClient(options: ILovePdfClientOptions): ILovePdfClient {
  return new ILovePdfClient(options);
}

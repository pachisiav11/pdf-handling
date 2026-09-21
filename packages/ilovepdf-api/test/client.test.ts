import { describe, expect, it, vi } from 'vitest';
import { ILovePdfError, createILovePdfClient } from '../src/index';

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Records every request and replies with a full start-upload-process-download run. */
function stubApi(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [fragment, reply] of Object.entries(overrides)) {
      if (url.includes(fragment)) return reply();
    }
    if (url.includes('/v1/auth')) return jsonResponse({ token: 'public-token' });
    if (url.includes('/v1/start/')) return jsonResponse({ server: 'w1.ilovepdf.com', task: 'task-1' });
    if (url.includes('/v1/upload')) return jsonResponse({ server_filename: 'stored.pdf' });
    if (url.includes('/v1/process')) {
      return jsonResponse({ status: 'TaskSuccess', download_filename: 'out.pdf', output_filenumber: 1 });
    }
    if (url.includes('/v1/download/')) return new Response(new Uint8Array([1, 2, 3]));
    throw new Error(`unstubbed request: ${url}`);
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const file = { name: 'a.pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

function client(fetch: typeof globalThis.fetch, extra: Record<string, unknown> = {}) {
  return createILovePdfClient({ publicKey: 'project_public_test', fetch, ...extra });
}

describe('request construction', () => {
  it('runs auth, start, upload, process and download in order', async () => {
    const { calls, fetch } = stubApi();
    const bytes = await client(fetch).process('rotate', [file]);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/auth',
      '/v1/start/rotate/in',
      '/v1/upload',
      '/v1/process',
      '/v1/download/task-1',
    ]);
  });

  it('puts the region in the start path and targets the assigned task server', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch, { region: 'eu' }).process('compress', [file]);

    expect(calls[1]!.url).toBe('https://api.ilovepdf.com/v1/start/compress/eu');
    expect(calls[2]!.url).toBe('https://w1.ilovepdf.com/v1/upload');
    expect(calls[4]!.url).toBe('https://w1.ilovepdf.com/v1/download/task-1');
  });

  it('sends the bearer token on every call after auth', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch).process('rotate', [file]);

    for (const call of calls.slice(1)) {
      expect(new Headers(call.init.headers).get('Authorization')).toBe('Bearer public-token');
    }
  });

  it('prefers an injected token provider over the public auth endpoint', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch, { tokenProvider: async () => 'signed-token' }).process('rotate', [file]);

    expect(calls.some((c) => c.url.includes('/v1/auth'))).toBe(false);
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer signed-token');
  });

  it('falls back to the public auth flow when the provider returns nothing', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch, { tokenProvider: async () => undefined }).process('rotate', [file]);

    expect(calls[0]!.url).toContain('/v1/auth');
  });

  it('authenticates once for a multi-file task', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch).process('merge', [file, { name: 'b.pdf', bytes: new Uint8Array([1]) }]);

    expect(calls.filter((c) => c.url.includes('/v1/auth'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/v1/upload'))).toHaveLength(2);
  });

  it('forwards process parameters alongside the uploaded file references', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch).process('split', [file], { split_mode: 'ranges', ranges: '1-2' });

    const body = JSON.parse(String(calls[3]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      task: 'task-1',
      tool: 'split',
      split_mode: 'ranges',
      ranges: '1-2',
      files: [{ server_filename: 'stored.pdf', filename: 'a.pdf', rotate: 0 }],
    });
  });

  it('passes a per-file rotation through to the process request', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch).process('rotate', [{ ...file, rotate: 270 }]);

    const body = JSON.parse(String(calls[3]!.init.body)) as { files: Array<{ rotate: number }> };
    expect(body.files[0]!.rotate).toBe(270);
  });
});

describe('multipart upload body', () => {
  it('sends a boundary-matched body carrying the task, filename and raw bytes', async () => {
    const { calls, fetch } = stubApi();
    await client(fetch).process('rotate', [file]);

    const upload = calls[2]!;
    const contentType = new Headers(upload.init.headers).get('Content-Type') ?? '';
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];
    expect(boundary).toBeTruthy();

    const body = upload.init.body as unknown as Uint8Array;
    expect(body).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder('latin1').decode(body);

    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    expect(text).toContain('Content-Disposition: form-data; name="task"');
    expect(text).toContain('task-1');
    expect(text).toContain('name="file"; filename="a.pdf"');
    expect(text).toContain('Content-Type: application/pdf');
    expect(text).toContain('%PDF');
  });

  it('does not corrupt non-ASCII file bytes', async () => {
    const { calls, fetch } = stubApi();
    const binary = new Uint8Array([0x00, 0x80, 0xff, 0x0a, 0x0d]);
    await client(fetch).process('rotate', [{ name: 'b.pdf', bytes: binary }]);

    const body = calls[2]!.init.body as unknown as Uint8Array;
    // The file part's payload starts after its own header block, not the task part's.
    const marker = new TextEncoder().encode('Content-Type: application/pdf\r\n\r\n');
    let start = -1;
    outer: for (let i = 0; i <= body.length - marker.length; i += 1) {
      for (let j = 0; j < marker.length; j += 1) if (body[i + j] !== marker[j]) continue outer;
      start = i + marker.length;
      break;
    }
    expect(start).toBeGreaterThan(0);
    expect(Array.from(body.slice(start, start + binary.length))).toEqual(Array.from(binary));
  });
});

describe('error reporting', () => {
  it('unwraps iLovePDF nested error envelopes', async () => {
    const { fetch } = stubApi({
      '/v1/process': () =>
        jsonResponse({ error: { type: 'ProcessingError', message: 'The file is corrupt' } }, 400),
    });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow(/The file is corrupt/);
  });

  it('surfaces per-file errors nested under param.files', async () => {
    const { fetch } = stubApi({
      '/v1/upload': () =>
        jsonResponse({ error: { param: { files: [{ error: 'PDF is password protected' }] } } }, 400),
    });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow(/password protected/);
  });

  it('reports the HTTP status when the body carries no message', async () => {
    const { fetch } = stubApi({ '/v1/start/': () => new Response('', { status: 402 }) });

    await expect(client(fetch).process('rotate', [file])).rejects.toMatchObject({
      name: 'ILovePdfError',
      status: 402,
    });
  });

  it('fails a task that did not reach a success status', async () => {
    const { fetch } = stubApi({
      '/v1/process': () => jsonResponse({ status: 'TaskError', status_message: 'Out of credits' }),
    });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow('Out of credits');
  });

  it('rejects an empty file list without any network call', async () => {
    const { calls, fetch } = stubApi();

    await expect(client(fetch).process('merge', [])).rejects.toBeInstanceOf(ILovePdfError);
    expect(calls).toHaveLength(0);
  });

  it('rejects a start response missing the task server', async () => {
    const { fetch } = stubApi({ '/v1/start/': () => jsonResponse({ task: 'task-1' }) });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow(/invalid task response/);
  });

  it('rejects an upload the API did not store', async () => {
    const { fetch } = stubApi({ '/v1/upload': () => jsonResponse({}) });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow(/did not accept a\.pdf/);
  });
});

describe('resilience', () => {
  it('retries a retryable status and then succeeds', async () => {
    let attempts = 0;
    const { calls, fetch } = stubApi({
      '/v1/start/': () => {
        attempts += 1;
        return attempts === 1
          ? new Response('', { status: 503 })
          : jsonResponse({ server: 'w1.ilovepdf.com', task: 'task-1' });
      },
    });

    await client(fetch).process('rotate', [file]);
    expect(attempts).toBe(2);
    expect(calls.filter((c) => c.url.includes('/v1/start/'))).toHaveLength(2);
  });

  it('does not retry a client error', async () => {
    let attempts = 0;
    const { fetch } = stubApi({
      '/v1/start/': () => {
        attempts += 1;
        return jsonResponse({ error: { message: 'Bad tool' } }, 400);
      },
    });

    await expect(client(fetch).process('rotate', [file])).rejects.toThrow('Bad tool');
    expect(attempts).toBe(1);
  });

  it('re-authenticates once after a 401 and retries the call', async () => {
    let uploads = 0;
    const { calls, fetch } = stubApi({
      '/v1/upload': () => {
        uploads += 1;
        return uploads === 1
          ? new Response('', { status: 401 })
          : jsonResponse({ server_filename: 'stored.pdf' });
      },
    });

    await client(fetch).process('rotate', [file]);
    expect(uploads).toBe(2);
    expect(calls.filter((c) => c.url.includes('/v1/auth'))).toHaveLength(2);
  });

  it('reports a timeout rather than leaking an AbortError', async () => {
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(client(fetch, { timeoutMs: 10 }).process('rotate', [file])).rejects.toThrow(
      /did not answer within 10 ms/,
    );
  });
});

describe('multi-file output', () => {
  it('flags a packaged archive from output_filenumber', async () => {
    const { fetch } = stubApi({
      '/v1/process': () =>
        jsonResponse({ status: 'TaskSuccess', download_filename: 'pages.zip', output_filenumber: 5 }),
    });

    const result = await client(fetch).processDetailed('split', [file], { split_mode: 'fixed_range' });
    expect(result).toMatchObject({ filename: 'pages.zip', fileCount: 5, archive: true });
  });

  it('reports a single output as not archived', async () => {
    const { fetch } = stubApi();

    const result = await client(fetch).processDetailed('rotate', [file]);
    expect(result.archive).toBe(false);
    expect(result.fileCount).toBe(1);
  });
});

describe('configuration', () => {
  it('refuses to construct without a public key', () => {
    expect(() => createILovePdfClient({ publicKey: '' })).toThrow(/public key is required/);
  });
});

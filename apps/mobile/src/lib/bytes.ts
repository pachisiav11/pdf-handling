/**
 * Base64 <-> Uint8Array helpers.
 *
 * react-native-blob-util reads/writes file contents as base64 strings; pdf-lib
 * works on Uint8Array. Hermes ships `atob`/`btoa`, but they choke on binary
 * strings above the Latin-1 range in some RN versions, so these do the encoding
 * by hand — no globals, no dependencies, deterministic on Hermes.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
  table['='.charCodeAt(0)] = 0;
  return table;
})();

export function base64ToBytes(base64: string): Uint8Array {
  // Strip whitespace/newlines that some encoders insert.
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  let padding = 0;
  if (len >= 1 && clean[len - 1] === '=') padding++;
  if (len >= 2 && clean[len - 2] === '=') padding++;
  const byteLength = (len / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)];
    const b = LOOKUP[clean.charCodeAt(i + 1)];
    const c = LOOKUP[clean.charCodeAt(i + 2)];
    const d = LOOKUP[clean.charCodeAt(i + 3)];
    if (p < byteLength) bytes[p++] = (a << 2) | (b >> 4);
    if (p < byteLength) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < byteLength) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    out += CHARS[a >> 2];
    out += CHARS[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < len ? CHARS[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < len ? CHARS[c & 63] : '=';
  }
  return out;
}

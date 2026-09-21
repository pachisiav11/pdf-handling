import RNBlobUtil from 'react-native-blob-util';
import { bytesToBase64 } from '../lib/bytes';

export interface ViewerFile {
  key: string;
  url: string;
}

const keys = new WeakMap<Uint8Array, string>();
const session = Date.now().toString(36);
let counter = 0;

/** Stable id for one version of a document's bytes (every edit makes new bytes). */
export function docKey(bytes: Uint8Array): string {
  let key = keys.get(bytes);
  if (!key) {
    key = `${session}-${++counter}`;
    keys.set(bytes, key);
  }
  return key;
}

let current: { key: string; file: Promise<ViewerFile> } | null = null;

/**
 * The pdf.js WebViews read the document from a cache file (passing megabytes
 * through the JS bridge would be far slower). Only the newest version is kept.
 */
export function viewerFileFor(bytes: Uint8Array): Promise<ViewerFile> {
  const key = docKey(bytes);
  if (current?.key === key) return current.file;
  const previous = current;
  const path = `${RNBlobUtil.fs.dirs.CacheDir}/viewer-${key}.pdf`;
  const file = RNBlobUtil.fs
    .writeFile(path, bytesToBase64(bytes), 'base64')
    .then(() => ({ key, url: `file://${path}` }));
  const entry = { key, file };
  current = entry;
  file.catch(() => {
    if (current === entry) current = null;
  });
  previous?.file
    .then((f) => RNBlobUtil.fs.unlink(f.url.slice('file://'.length)))
    .catch(() => {});
  return file;
}

export const VIEWER_URL = 'file:///android_asset/viewer/index.html';

/** Script that hands a message to the page inside the WebView. */
export function receiveScript(msg: object): string {
  return `window.pdfxReceive && window.pdfxReceive(${JSON.stringify(msg)});true;`;
}

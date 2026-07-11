import { Platform } from 'react-native';
import RNBlobUtil from 'react-native-blob-util';
import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { base64ToBytes, bytesToBase64 } from './bytes';

export interface PickedPdf {
  name: string;
  bytes: Uint8Array;
}

const stripScheme = (uri: string): string => uri.replace(/^file:\/\//, '');

/**
 * Present the system document picker, copy the chosen PDF into app cache
 * (turning a content:// uri into a readable file), and return its bytes.
 * Returns null if the user cancels.
 */
export async function pickPdf(): Promise<PickedPdf | null> {
  try {
    const [file] = await pick({ type: [types.pdf] });
    if (!file) return null;
    const name = file.name ?? 'document.pdf';
    const [copy] = await keepLocalCopy({
      files: [{ uri: file.uri, fileName: name }],
      destination: 'cachesDirectory',
    });
    if (copy.status !== 'success') {
      throw new Error(copy.copyError || 'Could not read the selected file.');
    }
    const base64 = await RNBlobUtil.fs.readFile(stripScheme(copy.localUri), 'base64');
    return { name, bytes: base64ToBytes(base64) };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) return null;
    throw err;
  }
}

/**
 * Write PDF bytes into the device's public Downloads folder via MediaStore so
 * the file is visible in the Files app. Returns a human-readable location.
 */
export async function savePdfToDownloads(name: string, bytes: Uint8Array): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\.pdf$/i, '') + '.pdf';
  const tmp = `${RNBlobUtil.fs.dirs.CacheDir}/${Date.now()}-${safeName}`;
  await RNBlobUtil.fs.writeFile(tmp, bytesToBase64(bytes), 'base64');

  if (Platform.OS === 'android') {
    await RNBlobUtil.MediaCollection.copyToMediaStore(
      { name: safeName, parentFolder: '', mimeType: 'application/pdf' },
      'Download',
      tmp,
    );
    await RNBlobUtil.fs.unlink(tmp).catch(() => {});
    return `Downloads/${safeName}`;
  }

  // iOS/other: leave the file in the app document dir.
  const docPath = `${RNBlobUtil.fs.dirs.DocumentDir}/${safeName}`;
  await RNBlobUtil.fs.cp(tmp, docPath).catch(() => {});
  await RNBlobUtil.fs.unlink(tmp).catch(() => {});
  return docPath;
}

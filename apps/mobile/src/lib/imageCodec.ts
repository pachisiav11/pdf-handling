import type { ImageReencoder } from '@pdfx/core/mobile';
import PdfxNative from '../specs/NativePdfxNative';
import { base64ToBytes, bytesToBase64 } from './bytes';

/**
 * Image re-encoder for compression, backed by the Android PdfxNative module.
 * Decoding, downscaling and JPEG encoding all happen natively; only the
 * compressed input and the JPEG output cross the bridge.
 */
export const nativeReencoder: ImageReencoder = async (source, { maxDimension, quality }) => {
  try {
    const out =
      source.kind === 'jpeg'
        ? await PdfxNative.reencodeJpeg(bytesToBase64(source.bytes), maxDimension, quality)
        : await PdfxNative.reencodeFlate(
            bytesToBase64(source.bytes),
            source.width,
            source.height,
            source.colors,
            source.predictor,
            source.palette ? bytesToBase64(source.palette.lookup) : '',
            source.palette?.colors ?? 0,
            maxDimension,
            quality,
          );
    return out ? base64ToBytes(out) : null;
  } catch {
    return null;
  }
};

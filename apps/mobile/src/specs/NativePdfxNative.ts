import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Native helpers the JS side can't do well on Hermes. Image methods return a
 * base64 JPEG, or an empty string when the image should be left untouched.
 */
export interface Spec extends TurboModule {
  reencodeJpeg(base64: string, maxDimension: number, quality: number): Promise<string>;
  reencodeFlate(
    base64: string,
    width: number,
    height: number,
    colors: number,
    predictor: number,
    paletteBase64: string,
    paletteColors: number,
    maxDimension: number,
    quality: number,
  ): Promise<string>;
  /** Display name of a content:// document, or '' when unknown. */
  displayName(uri: string): Promise<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PdfxNative');

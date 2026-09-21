import type React from 'react';
import { WebView, type WebViewProps } from 'react-native-webview';

export interface PdfWebViewHandle {
  injectJavaScript(script: string): void;
  reload(): void;
}

// react-native-webview declares `WebView<P = undefined>`, and `WebViewProps & undefined`
// collapses to `never` under TypeScript 5, so every prop fails to type-check.
export const PdfWebView = WebView as unknown as React.ComponentType<
  WebViewProps & React.RefAttributes<PdfWebViewHandle>
>;

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { PdfWebView, type PdfWebViewHandle } from './PdfWebView';
import { docKey, receiveScript, viewerFileFor, VIEWER_URL } from './viewerFiles';

interface Thumbs {
  /** JPEG data URL for a page of the current version, once rendered. */
  get(page: number): string | undefined;
  /** Pages now on screen; only these are rendered. */
  setVisible(pages: number[]): void;
  /** Hidden WebView that does the rendering — mount it once. */
  renderer: React.ReactElement;
}

/**
 * Real page thumbnails for the grid, rendered by pdf.js in a hidden WebView.
 * Lazy: a page is requested only when its cell becomes visible.
 */
export function useThumbnails(bytes: Uint8Array, pixelWidth: number): Thumbs {
  const web = useRef<PdfWebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const key = docKey(bytes);
  const s = useRef({
    key: '',
    loaded: false,
    cache: new Map<number, string>(),
    sent: new Set<number>(),
    visible: [] as number[],
  }).current;

  const send = (msg: object) => web.current?.injectJavaScript(receiveScript(msg));

  const requestVisible = () => {
    if (!s.loaded) return;
    for (const page of s.visible) {
      if (s.cache.has(page) || s.sent.has(page)) continue;
      s.sent.add(page);
      send({ type: 'thumb', key: s.key, page, width: pixelWidth });
    }
  };

  useEffect(() => {
    s.key = key;
    s.loaded = false;
    s.cache = new Map();
    s.sent = new Set();
    rerender();
    if (!ready) return;
    let alive = true;
    viewerFileFor(bytes)
      .then(({ url }) => alive && send({ type: 'load', url, key }))
      .catch((err) => console.warn('[pdfx] thumbnails unavailable:', err));
    return () => {
      alive = false;
    };
  }, [ready, key]); // `bytes` is represented by `key`

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data) as {
      type: string;
      key?: string;
      page?: number;
      dataUrl?: string;
      message?: string;
    };
    if (msg.type === 'ready') setReady(true);
    else if (msg.key !== s.key) return;
    else if (msg.type === 'loaded') {
      s.loaded = true;
      requestVisible();
    } else if (msg.type === 'thumb' && msg.page !== undefined && msg.dataUrl) {
      s.cache.set(msg.page, msg.dataUrl);
      rerender();
    } else if (msg.type === 'error') {
      console.warn('[pdfx] thumbnail render failed:', msg.message);
    }
  };

  const setVisible = useCallback((pages: number[]) => {
    s.visible = pages;
    requestVisible();
  }, []); // requestVisible only reads the mutable ref

  const renderer = (
    <PdfWebView
      ref={web}
      style={styles.hidden}
      pointerEvents="none"
      source={{ uri: VIEWER_URL }}
      injectedJavaScriptBeforeContentLoaded="window.PDFX_MODE='thumbs';true;"
      originWhitelist={['*']}
      allowFileAccess
      allowFileAccessFromFileURLs
      onMessage={onMessage}
      onRenderProcessGone={() => {
        // The renderer can be killed under memory pressure; start over.
        setReady(false);
        web.current?.reload();
      }}
    />
  );

  return { get: (page) => s.cache.get(page), setVisible, renderer };
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});

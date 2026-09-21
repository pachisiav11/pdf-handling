import React, { useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WebViewMessageEvent } from 'react-native-webview';
import { PdfWebView, type PdfWebViewHandle } from './PdfWebView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { receiveScript, viewerFileFor, VIEWER_URL } from './viewerFiles';

interface Props {
  name: string;
  bytes: Uint8Array;
  startPage: number;
  onClose: () => void;
  onError: (message: string) => void;
}

/** Full-screen pdf.js reader: vertical scrolling, pinch zoom. */
export function ViewerScreen({ name, bytes, startPage, onClose, onError }: Props) {
  const web = useRef<PdfWebViewHandle>(null);

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data) as { type: string; message?: string };
    if (msg.type === 'ready') {
      viewerFileFor(bytes)
        .then((file) =>
          web.current?.injectJavaScript(receiveScript({ type: 'load', ...file, page: startPage })),
        )
        .catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)));
    } else if (msg.type === 'error' && msg.message) {
      onError(`Could not display this PDF: ${msg.message}`);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.back}>‹ Pages</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <PdfWebView
          ref={web}
          style={styles.web}
          source={{ uri: VIEWER_URL }}
          injectedJavaScriptBeforeContentLoaded="window.PDFX_MODE='view';true;"
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          setBuiltInZoomControls
          setDisplayZoomControls={false}
          onMessage={onMessage}
          onRenderProcessGone={() => web.current?.reload()}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1c1f24' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#3a414b',
    backgroundColor: '#23272e',
  },
  back: { color: '#12b5cb', fontSize: 15, fontWeight: '600' },
  title: { color: '#e7e9ec', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  web: { flex: 1, backgroundColor: '#1c1f24' },
});

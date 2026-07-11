import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  actions,
  clearError,
  closeDoc,
  openViaPicker,
  toggleSelect,
  useStore,
  type State,
} from './state/store';
import type { CompressPreset, NumberPosition } from '@pdfx/core/mobile';

const C = {
  desk: '#1c1f24',
  panel: '#23272e',
  panel2: '#2b3038',
  line: '#3a414b',
  paper: '#f4f1ea',
  ink: '#e7e9ec',
  dim: '#9aa3ad',
  cyan: '#12b5cb', // action
  magenta: '#e0457b', // destructive
  yellow: '#e6b422', // unsaved
};

export function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.desk} />
        <Root />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Root() {
  const state = useStore();
  return (
    <View style={styles.fill}>
      {state.doc ? <DocScreen state={state} /> : <Home />}
      {state.busy && (
        <View style={styles.overlay}>
          <View style={styles.busyCard}>
            <ActivityIndicator color={C.cyan} />
            <Text style={styles.busyText}>{state.busy}…</Text>
          </View>
        </View>
      )}
      {state.error && (
        <Pressable style={[styles.toast, styles.toastError]} onPress={clearError}>
          <Text style={styles.toastText}>{state.error}</Text>
          <Text style={styles.toastDismiss}>Dismiss</Text>
        </Pressable>
      )}
      {state.notice && !state.error && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{state.notice}</Text>
        </View>
      )}
    </View>
  );
}

function Home() {
  return (
    <View style={styles.home}>
      <Text style={styles.logo}>PDFX</Text>
      <Text style={styles.tagline}>Offline PDF tools · nothing leaves your device</Text>
      <Pressable style={styles.cta} onPress={() => void openViaPicker()}>
        <Text style={styles.ctaText}>Open a PDF</Text>
      </Pressable>
      <Text style={styles.homeHint}>
        Merge · Split · Rotate · Delete · Reorder · Extract · Compress · Watermark · Page numbers
      </Text>
    </View>
  );
}

function DocScreen({ state }: { state: State }) {
  const doc = state.doc!;
  const sel = state.selection;
  const [modal, setModal] = useState<null | 'split' | 'watermark' | 'pagenumbers' | 'compress'>(null);

  return (
    <View style={styles.fill}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={closeDoc} hitSlop={10}>
          <Text style={styles.headerClose}>‹ Close</Text>
        </Pressable>
        <View style={styles.headerTitleWrap}>
          {doc.dirty && <View style={styles.dirtyDot} />}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {doc.name}
          </Text>
        </View>
        <Pressable style={styles.saveBtn} onPress={() => void actions.save()} hitSlop={8}>
          <Text style={styles.saveBtnText}>Save</Text>
        </Pressable>
      </View>

      {/* Page grid */}
      <ScrollView contentContainerStyle={styles.grid}>
        {Array.from({ length: doc.pageCount }, (_, i) => {
          const selected = sel.includes(i);
          return (
            <Pressable key={i} style={styles.tileWrap} onPress={() => toggleSelect(i)}>
              <View style={[styles.tile, selected && styles.tileSelected]}>
                {selected && <RegistrationMarks />}
                <Text style={styles.tileNum}>{i + 1}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Selection status */}
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>
          {doc.pageCount} pages
          {sel.length > 0 ? ` · ${sel.length} selected` : ''} ·{' '}
          {(doc.bytes.length / 1024 / 1024).toFixed(2)} MB
        </Text>
        <Text style={styles.offline}>● offline</Text>
      </View>

      {/* Toolbar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
      >
        <Tool label="Rotate" onPress={() => void actions.rotate(90)} />
        <Tool
          label="Delete"
          tone="danger"
          disabled={!sel.length}
          onPress={() => void actions.deleteSelected()}
        />
        <Tool label="Extract" disabled={!sel.length} onPress={() => void actions.extractToDownloads()} />
        <Tool
          label="Reorder→front"
          disabled={!sel.length}
          onPress={() => void actions.moveSelectedToFront()}
        />
        <Tool label="Merge" onPress={() => void actions.mergeAnother()} />
        <Tool label="Split" onPress={() => setModal('split')} />
        <Tool label="Compress" onPress={() => setModal('compress')} />
        <Tool label="Watermark" onPress={() => setModal('watermark')} />
        <Tool label="Page #s" onPress={() => setModal('pagenumbers')} />
        <Tool label="Undo" disabled={!doc.history.length} onPress={() => actions.undo()} />
        <Tool label="Redo" disabled={!doc.future.length} onPress={() => actions.redo()} />
      </ScrollView>

      {modal === 'split' && <SplitModal max={doc.pageCount} onClose={() => setModal(null)} />}
      {modal === 'watermark' && <WatermarkModal onClose={() => setModal(null)} />}
      {modal === 'pagenumbers' && <PageNumbersModal onClose={() => setModal(null)} />}
      {modal === 'compress' && <CompressModal onClose={() => setModal(null)} />}
    </View>
  );
}

function RegistrationMarks() {
  return (
    <>
      <View style={[styles.mark, styles.markTL]} />
      <View style={[styles.mark, styles.markTR]} />
      <View style={[styles.mark, styles.markBL]} />
      <View style={[styles.mark, styles.markBR]} />
    </>
  );
}

function Tool({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <Pressable
      style={[styles.tool, disabled && styles.toolDisabled, tone === 'danger' && styles.toolDanger]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.toolText, tone === 'danger' && styles.toolDangerText]}>{label}</Text>
    </Pressable>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SplitModal({ max, onClose }: { max: number; onClose: () => void }) {
  const [range, setRange] = useState(`1-${max}`);
  return (
    <ModalShell title="Split — extract a page range" onClose={onClose}>
      <Text style={styles.modalHint}>
        e.g. 1-3, 5, 8-{max}
      </Text>
      <TextInput
        style={styles.input}
        value={range}
        onChangeText={setRange}
        autoCapitalize="none"
        placeholder="1-3, 5"
        placeholderTextColor={C.dim}
      />
      <ModalActions
        onClose={onClose}
        confirmLabel="Save range"
        onConfirm={() => {
          onClose();
          void actions.splitToDownloads(range.trim());
        }}
      />
    </ModalShell>
  );
}

function WatermarkModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('CONFIDENTIAL');
  return (
    <ModalShell title="Watermark" onClose={onClose}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Watermark text"
        placeholderTextColor={C.dim}
      />
      <ModalActions
        onClose={onClose}
        confirmLabel="Apply"
        disabled={!text.trim()}
        onConfirm={() => {
          onClose();
          void actions.watermark(text.trim());
        }}
      />
    </ModalShell>
  );
}

function PageNumbersModal({ onClose }: { onClose: () => void }) {
  const positions: NumberPosition[] = [
    'bottom-center',
    'bottom-right',
    'bottom-left',
    'top-center',
    'top-right',
    'top-left',
  ];
  return (
    <ModalShell title="Page numbers — position" onClose={onClose}>
      {positions.map((p) => (
        <Pressable
          key={p}
          style={styles.choiceRow}
          onPress={() => {
            onClose();
            void actions.pageNumbers(p);
          }}
        >
          <Text style={styles.choiceText}>{p}</Text>
        </Pressable>
      ))}
      <ModalActions onClose={onClose} />
    </ModalShell>
  );
}

function CompressModal({ onClose }: { onClose: () => void }) {
  const presets: Array<[CompressPreset, string]> = [
    ['low', 'Low — lossless re-save'],
    ['medium', 'Medium — lossless on mobile'],
    ['high', 'High — lossless on mobile'],
  ];
  return (
    <ModalShell title="Compress" onClose={onClose}>
      <Text style={styles.modalHint}>
        Image downscaling is desktop-only; mobile does a lossless re-save.
      </Text>
      {presets.map(([preset, label]) => (
        <Pressable
          key={preset}
          style={styles.choiceRow}
          onPress={() => {
            onClose();
            void actions.compress(preset);
          }}
        >
          <Text style={styles.choiceText}>{label}</Text>
        </Pressable>
      ))}
      <ModalActions onClose={onClose} />
    </ModalShell>
  );
}

function ModalActions({
  onClose,
  onConfirm,
  confirmLabel,
  disabled,
}: {
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.modalActions}>
      <Pressable style={styles.modalCancel} onPress={onClose}>
        <Text style={styles.modalCancelText}>Close</Text>
      </Pressable>
      {onConfirm && confirmLabel && (
        <Pressable
          style={[styles.modalConfirm, disabled && styles.toolDisabled]}
          onPress={onConfirm}
          disabled={disabled}
        >
          <Text style={styles.modalConfirmText}>{confirmLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.desk },
  fill: { flex: 1 },

  home: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  logo: { fontSize: 52, fontWeight: '800', color: C.paper, letterSpacing: 2 },
  tagline: { fontSize: 14, color: C.dim, textAlign: 'center' },
  cta: { marginTop: 18, backgroundColor: C.cyan, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 8 },
  ctaText: { color: '#04222a', fontSize: 18, fontWeight: '700' },
  homeHint: { marginTop: 22, fontSize: 12, color: C.dim, textAlign: 'center', lineHeight: 18 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.panel,
    gap: 10,
  },
  headerClose: { color: C.cyan, fontSize: 15, fontWeight: '600' },
  headerTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: C.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  dirtyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.yellow },
  saveBtn: { backgroundColor: C.cyan, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6 },
  saveBtnText: { color: '#04222a', fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 10 },
  tileWrap: {},
  tile: {
    width: 78,
    height: 104,
    backgroundColor: C.paper,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: { borderColor: C.cyan },
  tileNum: { color: '#2a2a2a', fontSize: 18, fontWeight: '700' },
  mark: { position: 'absolute', width: 10, height: 10, borderColor: C.magenta },
  markTL: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 },
  markTR: { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 },
  markBL: { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2 },
  markBR: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 },

  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  statusText: { color: C.dim, fontSize: 12 },
  offline: { color: '#5fbf6a', fontSize: 12 },

  toolbar: { paddingHorizontal: 10, paddingVertical: 12, gap: 8, backgroundColor: C.panel },
  tool: {
    backgroundColor: C.panel2,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.line,
  },
  toolText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  toolDisabled: { opacity: 0.35 },
  toolDanger: { borderColor: C.magenta },
  toolDangerText: { color: C.magenta },

  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.panel2,
    paddingVertical: 18,
    paddingHorizontal: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
  },
  busyText: { color: C.ink, fontSize: 15 },

  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 24,
    backgroundColor: C.panel2,
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toastError: { borderColor: C.magenta },
  toastText: { color: C.ink, fontSize: 13, flexShrink: 1 },
  toastDismiss: { color: C.cyan, fontWeight: '700', marginLeft: 12 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: C.panel,
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: C.line,
    gap: 12,
  },
  modalTitle: { color: C.paper, fontSize: 17, fontWeight: '700' },
  modalHint: { color: C.dim, fontSize: 12 },
  input: {
    backgroundColor: C.desk,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 6,
    color: C.ink,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  choiceRow: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 6, backgroundColor: C.panel2 },
  choiceText: { color: C.ink, fontSize: 15 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: C.dim, fontWeight: '600' },
  modalConfirm: { backgroundColor: C.cyan, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 6 },
  modalConfirmText: { color: '#04222a', fontWeight: '700' },
});

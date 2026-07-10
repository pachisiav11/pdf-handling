import React, { useState } from 'react';
import { Button, SafeAreaView, StatusBar, StyleSheet, Text } from 'react-native';
import { pick, types } from '@react-native-documents/picker';
import { ping } from '@pdfx/core';

export function App() {
  const [picked, setPicked] = useState<string | null>(null);

  const handlePick = async () => {
    try {
      const [file] = await pick({ type: [types.pdf] });
      if (file) setPicked(`${file.name ?? file.uri} (${file.size ?? '?'} bytes)`);
    } catch {
      // user cancelled — not an error
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>PDFX</Text>
      <Text style={styles.sub}>Shared core says: {ping()}</Text>
      <Button title="Pick a PDF…" onPress={handlePick} />
      {picked && <Text style={styles.sub}>Picked: {picked}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 14, color: '#555' },
});

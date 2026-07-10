// Standalone renderer config for browser-based UI checks (no Electron).
// Mirrors the renderer section of electron.vite.config.ts.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  plugins: [react()],
  resolve: {
    alias: {
      '@pdfx/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});

import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload.ts' },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    resolve: {
      alias: {
        '@pdfx/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
  },
});

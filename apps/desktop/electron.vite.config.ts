import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    // Bundle @pdfx/core (it's TS source, not a published package); keep real deps external.
    plugins: [externalizeDepsPlugin({ exclude: ['@pdfx/core'] })],
    resolve: {
      // Longest key first: plain '@pdfx/core' must not shadow the subpath.
      alias: [
        {
          find: '@pdfx/core/convert/officeConvert',
          replacement: resolve(__dirname, '../../packages/core/src/convert/officeConvert.ts'),
        },
        { find: '@pdfx/core', replacement: resolve(__dirname, '../../packages/core/src/index.ts') },
      ],
    },
    build: {
      lib: { entry: 'electron/main.ts' },
      rollupOptions: {
        // Native module + worker-spawning dep must stay external (resolved at runtime).
        external: ['@napi-rs/canvas', 'tesseract.js', /\.node$/],
      },
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

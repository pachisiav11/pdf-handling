import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Renderer errors go to the local log file only (see main.ts logLocal).
window.addEventListener('error', (e) =>
  window.pdfx?.logError?.(`${e.message} @ ${e.filename}:${e.lineno}`),
);
window.addEventListener('unhandledrejection', (e) =>
  window.pdfx?.logError?.(`unhandledrejection: ${String(e.reason)}`),
);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

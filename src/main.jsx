import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Compatibilidad: pdfjs-dist (extracción de PDF) requiere Promise.withResolvers
// (ES2024). Está en todos los navegadores actuales, pero lo aseguramos para
// versiones antiguas de Safari/Firefox en lugar de fallar con un error críptico.
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

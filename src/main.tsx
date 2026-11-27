import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSync } from './lib/sync';
import { initStore } from './lib/store';
import { indexedDbPersist, memoryPersist } from './lib/idb';
import './styles.css';

// Refuse to run inside another site's frame (clickjacking). GitHub Pages can't send X-Frame-Options or a
// frame-ancestors header, and a <meta> CSP can't set frame-ancestors, so this check is the protection.
const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
if (framed) {
  document.getElementById('root')!.textContent = 'Momig can only be opened directly at momig.app.';
} else {
  createRoot(document.getElementById('root')!).render(<App />);
  // sync starts once the device's copy is loaded, and before the first screen can sign in
  initStore(typeof indexedDB !== 'undefined' ? indexedDbPersist() : memoryPersist(), startSync);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker?.register('./sw.js', { updateViaCache: 'none' }).then(r => {
      r.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') r.update().catch(() => {}); });
    }).catch(() => {});
  });
  // a new version took over: reload once so the screen shows it (never mid-form: only when hidden or on next open)
  let reloaded = false; const hadController = !!navigator.serviceWorker?.controller;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return; reloaded = true;
    if (document.visibilityState === 'hidden') location.reload(); else document.addEventListener('visibilitychange', () => location.reload(), { once: true });
  });
}

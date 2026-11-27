// The Android back button (and browser Back) closes the top sheet, dialog or screen instead of leaving the app
// (Bebig QA M5). Each open layer adds a history entry; Back pops it and closes that layer. A layer closed by the
// app itself (Save, ×) removes its own entry, and the popstate that causes is ignored.
import { useEffect, useRef } from 'react';

const layers: (() => void)[] = [];
let ownPops = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ownPops > 0) { ownPops--; return; }
    layers.pop()?.();
  });
}

export function useBackLayer(open: boolean, onClose: () => void) {
  const cb = useRef(onClose); cb.current = onClose;
  useEffect(() => {
    if (!open) return;
    let byBack = false;
    const close = () => { byBack = true; cb.current(); };
    history.pushState({ momigLayer: true }, '');
    layers.push(close);
    return () => {
      const i = layers.indexOf(close);
      if (i >= 0) layers.splice(i, 1);
      if (!byBack) { ownPops++; history.back(); }
    };
  }, [open]);
}
export const openLayers = () => layers.length;

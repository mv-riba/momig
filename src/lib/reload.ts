// Reloading for a new version waits while a screen holds it (e.g. she's typing a code from her email),
// then happens the next time the app is hidden or opened.
let holds = 0;
let waiting: (() => void) | null = null;

export function holdReload(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return; released = true; holds--;
    if (!holds && waiting) { const run = waiting; waiting = null; run(); }
  };
}
export const reloadHeld = () => holds > 0;
/** Runs `reload` now, or once every hold has been released. */
export function reloadWhenAllowed(reload: () => void) { if (holds) waiting = reload; else reload(); }

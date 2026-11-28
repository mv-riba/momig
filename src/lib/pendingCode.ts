// A code step on the sign-in screen (confirm the email, or reset the password) that is still waiting for her code.
// It's kept on the device, so the screen comes back if the app reloads or the phone closes it in the background
// while she's in her email app reading the code. Codes expire after an hour, so an older step is dropped.
export type PendingCode = { mode: 'confirm' | 'reset'; email: string; at: number };

const KEY = 'momig:pending-code';
export const PENDING_MAX_AGE = 60 * 60000;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export function readPendingCode(now = Date.now(), s: Storage | null = store()): PendingCode | null {
  try {
    const p = JSON.parse(s?.getItem(KEY) || 'null');
    if (!p || (p.mode !== 'confirm' && p.mode !== 'reset') || typeof p.email !== 'string' || !p.email || typeof p.at !== 'number') return null;
    if (now - p.at > PENDING_MAX_AGE || p.at > now + 60000) { s?.removeItem(KEY); return null; }
    return p;
  } catch { return null; }
}
export function savePendingCode(mode: PendingCode['mode'], email: string, now = Date.now(), s: Storage | null = store()) {
  try { s?.setItem(KEY, JSON.stringify({ mode, email: email.trim().toLowerCase(), at: now })); } catch { /* private browsing: the screen just won't come back */ }
}
export function clearPendingCode(s: Storage | null = store()) { try { s?.removeItem(KEY); } catch { /* */ } }

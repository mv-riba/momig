// Cloudflare Turnstile (CAPTCHA) on sign-in, sign-up and password reset.
// The token goes to Supabase Auth, which verifies it with the secret key (Authentication → Attack Protection).
// Only shown with cloud sync and a configured site key (see momig.config.json → turnstileSiteKey).
import React, { useEffect, useRef, useState } from 'react';
import { config } from '../lib/config';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: TurnstileApi } }

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; s.remove(); reject(new Error('Turnstile failed to load')); };
    document.head.appendChild(s);
  });
}

export const captchaEnabled = () => !!(config.turnstileSiteKey && config.supabaseUrl);

/** Renders the Turnstile widget. `action` names the protected form; bump `resetSignal` after each submit (tokens are single-use). */
export function Captcha({ action, resetSignal, onToken }: { action: 'signin' | 'signup' | 'reset'; resetSignal: number; onToken(token: string | null): void }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const cb = useRef(onToken); cb.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    cb.current(null); setFailed(false);
    loadTurnstile().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id.current = window.turnstile.render(box.current, {
        sitekey: config.turnstileSiteKey, action, theme: 'light', size: 'flexible',
        callback: (t: string) => { setFailed(false); cb.current(t); },
        'expired-callback': () => cb.current(null),
        'timeout-callback': () => cb.current(null),
        'error-callback': () => { cb.current(null); setFailed(true); return true; },
      });
    }).catch(() => { if (!gone) setFailed(true); });
    return () => {
      gone = true;
      if (id.current && window.turnstile) { try { window.turnstile.remove(id.current); } catch { /* already gone */ } }
      id.current = null;
    };
  }, [action]);

  useEffect(() => {
    if (!resetSignal || !id.current || !window.turnstile) return;
    cb.current(null); window.turnstile.reset(id.current);
  }, [resetSignal]);

  return (
    <div className="captcha">
      <div ref={box} />
      {failed && <p className="muted tiny center">The security check couldn’t load. Check your connection, then try again.</p>}
    </div>
  );
}

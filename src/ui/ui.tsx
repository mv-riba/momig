import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { IBack, IX, IInfo } from './icons';
import { useBackLayer } from './back';

// ---------- Ticking clock (greeting, "today" rolling over at midnight) ----------
export function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [intervalMs]);
  return now;
}

// ---------- Toasts ----------
interface ToastMsg { id: number; text: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: string, action?: ToastMsg['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const push = useCallback((text: string, action?: ToastMsg['action']) => {
    const id = Date.now() + Math.random();
    setItems(x => [...x.slice(-2), { id, text, action }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), action ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && <button className="toast-action" onClick={() => { t.action!.run(); setItems(x => x.filter(y => y.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Screens and sheets (both close with the back button) ----------
export function Page({ title, onBack, right, children }: { title: string; onBack: () => void; right?: React.ReactNode; children: React.ReactNode }) {
  useBackLayer(true, onBack);
  return (
    <div className="page">
      <header className="page-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><IBack /></button>
        <h1>{title}</h1>
        <div className="page-head-r">{right}</div>
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useBackLayer(open, onClose);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><IX /></button></div>
        {children}
      </div>
    </div>
  );
}

// ---------- Controls ----------
export function Field({ label, hint, children, error }: { label: string; hint?: string; children: React.ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}{hint && <em> {hint}</em>}</span>
      {children}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}
export function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on === undefined ? undefined : on} onClick={onClick}>{children}</button>;
}
export function SwitchRow({ title, sub, checked, onChange, icon, disabled }: { title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={`row ${disabled ? 'row-off' : ''}`}>
      {icon}
      <span className="row-main"><span className="row-title">{title}</span>{sub && <span className="row-sub">{sub}</span>}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}
export function Row({ title, sub, onClick, right }: { title: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; right?: React.ReactNode }) {
  const inner = <><span className="row-main"><span className="row-title">{title}</span>{sub && <span className="row-sub">{sub}</span>}</span>{right}</>;
  return onClick ? <button type="button" className="row tap" onClick={onClick}>{inner}</button> : <div className="row">{inner}</div>;
}
export function Note({ kind = 'soft', icon, children }: { kind?: 'soft' | 'under' | 'over' | 'ok' | 'error' | 'info'; icon?: React.ReactNode; children: React.ReactNode }) {
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{icon ?? <IInfo size={18} />}<div>{children}</div></div>;
}
export const Disclaimer = ({ long }: { long?: boolean }) => (
  <p className="disc">{long ? 'Momig is a personal log, not medical advice. For anything about your recovery, feeding or mood, talk to your midwife or doctor.' : 'A personal log, not medical advice.'}</p>
);

// ---------- In-app confirmation (works in installed apps, where window.confirm can be blocked) ----------
interface ConfirmOpts { title: string; text?: string; ok?: string; cancel?: string; danger?: boolean; typeWord?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>(resolve => { setTyped(''); setSt({ ...o, resolve }); }), []);
  const close = useCallback((v: boolean) => { setSt(cur => { cur?.resolve(v); return null; }); }, []);
  const cancel = useCallback(() => close(false), [close]);
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Sheet open={!!st} onClose={cancel} title={st?.title ?? ''}>
        {st?.text && <p className="muted">{st.text}</p>}
        {st?.typeWord && <Field label={`Type ${st.typeWord} to confirm`}><input autoFocus autoCapitalize="characters" value={typed} onChange={e => setTyped(e.target.value)} /></Field>}
        <div className="btn-row">
          <button className="btn soft" onClick={cancel}>{st?.cancel ?? 'Cancel'}</button>
          <button className={`btn ${st?.danger ? 'danger' : 'primary'}`} disabled={!!st?.typeWord && typed.trim().toUpperCase() !== st.typeWord} onClick={() => close(true)}>{st?.ok ?? 'Confirm'}</button>
        </div>
      </Sheet>
    </ConfirmCtx.Provider>
  );
}

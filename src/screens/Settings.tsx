import React, { useEffect, useState } from 'react';
import { useMe } from '../ui/me';
import { SwitchRow, Field, Row, Disclaimer, useConfirm, useToast, Note } from '../ui/ui';
import { IFood, IWater, IMove } from '../ui/icons';
import { updateSettings, updateName, signOut, deleteAccount, isRemote, useStore } from '../lib/store';
import { syncNow, syncDiagnostics, lastSyncError } from '../lib/sync';
import { guessTimezone, isValidTimezone } from '../lib/time';
import { config } from '../lib/config';

/** A number box that saves when she leaves it (or presses Enter), within limits; blank allowed when `optional`. */
function NumberSetting({ label, hint, value, min, max, optional, onSave, placeholder }: { label: string; hint?: string; value: number | null; min: number; max: number; optional?: boolean; onSave: (v: number | null) => void; placeholder?: string }) {
  const [v, setV] = useState(value == null ? '' : String(value)); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  const commit = () => {
    setErr(null);
    if (!v.trim()) { if (optional) { if (value !== null) onSave(null); } else setV(String(value ?? '')); return; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) { setErr(`Please enter a number from ${min.toLocaleString('en-GB')} to ${max.toLocaleString('en-GB')}.`); return; }
    if (n !== value) onSave(n);
  };
  return <Field label={label} hint={hint} error={err}><input inputMode="numeric" value={v} placeholder={placeholder} onChange={e => setV(e.target.value.replace(/[^\d]/g, '').slice(0, 5))} onBlur={commit} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></Field>;
}

export function Settings() {
  const me = useMe(); const confirm = useConfirm(); const toast = useToast();
  const lastSynced = useStore(s => s.lastSyncedAt); const waiting = useStore(s => s.outbox.length);
  const [name, setName] = useState(me?.name ?? '');
  const [diag, setDiag] = useState<string | null>(null);
  useEffect(() => { setName(me?.name ?? ''); }, [me?.name]);
  if (!me) return null;
  const s = me.settings; const deviceTz = guessTimezone();
  const del = async () => {
    const ok = await confirm({ title: 'Delete your account?', text: 'This permanently deletes your account and everything you’ve logged in Momig, on every device. It can’t be undone.', ok: 'Delete everything', danger: true, typeWord: 'DELETE' });
    if (!ok) return;
    try { await deleteAccount(); } catch (e: any) { toast(e?.message || 'Couldn’t delete the account. Check your connection and try again.'); }
  };
  return (
    <>
      <h1>Settings</h1>
      <div className="card">
        <Field label="Your name" hint="(optional)"><input value={name} maxLength={80} placeholder="e.g. Anna" onChange={e => setName(e.target.value)} onBlur={() => name.trim() !== me.name && updateName(name)} /></Field>
      </div>

      <h2>What you track</h2>
      <p className="small muted" style={{ marginTop: '-.6rem' }}>Only what you switch on appears in the app. Switching one off keeps what you logged.</p>
      <div className="card list">
        <SwitchRow icon={<span className="row-ic ic-food"><IFood size={20} /></span>} title="Food" sub="What you eat, with calories if you like" checked={s.track_food} onChange={v => updateSettings({ track_food: v })} />
        <SwitchRow icon={<span className="row-ic ic-water"><IWater size={20} /></span>} title="Water" sub="Glasses through the day" checked={s.track_water} onChange={v => updateSettings({ track_water: v })} />
        <SwitchRow icon={<span className="row-ic ic-move"><IMove size={20} /></span>} title="Movement" sub="Walks and gentle exercise" checked={s.track_move} onChange={v => updateSettings({ track_move: v })} />
      </div>

      {s.track_food && <>
        <h2>Food</h2>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <SwitchRow title="Hide numbers" sub="Log food without calories anywhere. Notes are off too." checked={s.hide_numbers} onChange={v => updateSettings({ hide_numbers: v })} />
          {!s.hide_numbers && <>
            <NumberSetting label="Daily calorie goal" hint="(your own number, optional)" value={s.kcal_goal} min={500} max={6000} optional placeholder="No goal" onSave={v => updateSettings({ kcal_goal: v })} />
            <p className="tiny muted" style={{ margin: 0 }}>Momig never suggests a number. Needs after birth vary a lot, especially if you’re breastfeeding, so if you’d like a goal, agree it with your midwife or doctor.</p>
            <SwitchRow title="Gentle under/over notes" sub={s.kcal_goal ? 'A short note on Today, never a warning' : 'Only when a goal is set'} checked={s.gentle_notes} disabled={!s.kcal_goal} onChange={v => updateSettings({ gentle_notes: v })} />
          </>}
        </div>
      </>}

      {s.track_water && <>
        <h2>Water</h2>
        <div className="card two">
          <NumberSetting label="Glasses a day" value={s.water_goal} min={1} max={30} onSave={v => updateSettings({ water_goal: v! })} />
          <NumberSetting label="ml each" value={s.glass_ml} min={50} max={1000} onSave={v => updateSettings({ glass_ml: v! })} />
        </div>
      </>}

      {s.timezone !== deviceTz && isValidTimezone(deviceTz) && (
        <Note kind="soft"><span>Days are counted in {s.timezone.replace(/_/g, ' ')} time, but this phone is set to {deviceTz.replace(/_/g, ' ')}. <button className="link small" onClick={() => updateSettings({ timezone: deviceTz })}>Use this phone’s time zone</button></span></Note>
      )}

      <h2>Account</h2>
      <div className="card list">
        <Row title="Signed in as" sub={me.email} />
        {isRemote() && <Row title="Sync" sub={waiting ? `${waiting} change${waiting === 1 ? '' : 's'} waiting to sync` : lastSynced ? `Up to date · ${new Date(lastSynced).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${lastSyncError() ? ' · ' + lastSyncError() : ''}` : 'Not synced yet'}
          right={<button className="link small" onClick={() => { syncNow(); syncDiagnostics().then(setDiag); }}>Sync now</button>} />}
        <Row title="Privacy policy" right={<a className="link small" href="/privacy/" target="_blank" rel="noopener">Open</a>} />
        <Row title="Terms" right={<a className="link small" href="/terms/" target="_blank" rel="noopener">Open</a>} />
        <Row title="Help" sub="support@momig.app" right={<a className="link small" href="mailto:support@momig.app">Email</a>} />
      </div>
      {diag && <div className="diag"><pre>{diag}</pre></div>}
      <button className="btn soft block" onClick={async () => {
        if (waiting && !(await confirm({ title: 'Sign out now?', text: `${waiting} change${waiting === 1 ? ' hasn’t' : 's haven’t'} synced yet. Signing out removes ${waiting === 1 ? 'it' : 'them'} from this phone. Go online and wait a moment to keep ${waiting === 1 ? 'it' : 'them'}.`, ok: 'Sign out anyway', danger: true }))) return;
        signOut();
      }}>Sign out</button>
      <button className="btn danger block" onClick={del}>Delete account</button>
      <p className="tiny muted center">Momig {config.version} · MVR Studios</p>
      <Disclaimer long />
    </>
  );
}

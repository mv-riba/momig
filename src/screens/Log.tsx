import React, { useState } from 'react';
import { Sheet, Field, Chip, useToast } from '../ui/ui';
import { useMe, type Me } from '../ui/me';
import { addEntry, updateEntry, deleteEntry, restoreEntry, getState } from '../lib/store';
import { QUICK_PICKS } from '../lib/foods';
import { recentFoods, dayData, glassesOf } from '../lib/calc';
import { todayKey, toLocalInput, fromLocalInput, formatTime } from '../lib/time';
import { MOVE_KINDS, type EntryTable, type FoodEntry, type MoveEntry, type MoveKind, type WaterEntry } from '../lib/types';
import { addGlass, removeGlass } from './Today';

export function LogSheets({ open, onClose }: { open: { kind: EntryTable; id?: string } | null; onClose: () => void }) {
  const me = useMe();
  const title = !open ? '' : open.kind === 'food' ? (open.id ? 'Edit food' : 'Log food') : open.kind === 'move' ? (open.id ? 'Edit movement' : 'Log movement') : 'Water';
  return (
    <Sheet open={!!open && !!me} onClose={onClose} title={title}>
      {open && me && (open.kind === 'food' ? <FoodForm key={open.id ?? 'new'} me={me} id={open.id} onDone={onClose} />
        : open.kind === 'move' ? <MoveForm key={open.id ?? 'new'} me={me} id={open.id} onDone={onClose} />
        : <WaterPanel me={me} id={open.id} onDone={onClose} />)}
    </Sheet>
  );
}

/** "When" for an entry: today by default; earlier days allowed, the future isn't. */
function When({ value, onChange, tz }: { value: string; onChange: (v: string) => void; tz: string }) {
  const [date, time] = value.split('T');
  return (
    <div className="two">
      <Field label="Day"><input type="date" max={todayKey(tz)} value={date} onChange={e => onChange(`${e.target.value}T${time}`)} required /></Field>
      <Field label="Time"><input type="time" value={time} onChange={e => onChange(`${date}T${e.target.value}`)} required /></Field>
    </div>
  );
}
function parseWhen(v: string, tz: string): string {
  const at = fromLocalInput(v, tz);
  if (Date.parse(at) > Date.now() + 60000) throw new Error('The time can’t be in the future.');
  return at;
}

function DeleteButton({ table, id, label, onDone }: { table: EntryTable; id: string; label: string; onDone: () => void }) {
  const toast = useToast();
  return <button type="button" className="btn danger block" onClick={() => { deleteEntry(table, id); onDone(); toast(`${label} removed`, { label: 'Undo', run: () => restoreEntry(table, id) }); }}>Remove</button>;
}

function FoodForm({ me, id, onDone }: { me: Me; id?: string; onDone: () => void }) {
  const toast = useToast(); const s = me.settings; const tz = s.timezone; const hide = s.hide_numbers;
  const cur = id ? (getState().food[id] as FoodEntry | undefined) : undefined;
  const [name, setName] = useState(cur?.name ?? ''); const [kcal, setKcal] = useState(cur?.kcal != null ? String(cur.kcal) : '');
  const [source, setSource] = useState<FoodEntry['source']>(cur?.source ?? 'manual');
  const [when, setWhen] = useState(toLocalInput(cur?.at ?? new Date(), tz));
  const [err, setErr] = useState<string | null>(null);
  const recent = recentFoods(me.all.food).filter(r => !QUICK_PICKS.some(q => q.name.toLowerCase() === r.name.toLowerCase()));
  const pick = (n: string, c: number | null, src: FoodEntry['source']) => { setName(n); setKcal(c != null ? String(c) : ''); setSource(src); setErr(null); };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const n = name.trim(); if (!n) return setErr('What did you have?');
    if (n.length > 120) return setErr('Please keep the name under 120 characters.');
    let k: number | null = null;
    if (!hide && kcal.trim()) { k = Number(kcal); if (!Number.isInteger(k) || k < 0 || k > 5000) return setErr('Calories should be a whole number up to 5,000.'); }
    if (hide && cur) k = cur.kcal; // hidden numbers stay as they were
    let at: string; try { at = parseWhen(when, tz); } catch (e: any) { return setErr(e.message); }
    if (cur) { updateEntry('food', cur.food_id, { name: n, kcal: k, source, at }); toast('Saved'); }
    else { addEntry('food', { name: n, kcal: k, source, at }); toast('Food logged'); }
    onDone();
  };
  return (
    <form onSubmit={save} style={{ display: 'contents' }}>
      <div className={hide ? '' : 'two-one'}>
        <Field label="What"><input value={name} maxLength={120} onChange={e => { setName(e.target.value); setSource('manual'); }} placeholder="e.g. Toast with jam" autoFocus={!cur} /></Field>
        {!hide && <Field label="kcal" hint="(optional)"><input inputMode="numeric" value={kcal} onChange={e => setKcal(e.target.value.replace(/[^\d]/g, '').slice(0, 4))} /></Field>}
      </div>
      {!hide && source === 'pick' && <p className="tiny muted" style={{ marginTop: '-.5rem' }}>Typical estimate. Edit it if you know better.</p>}
      {!cur && !!recent.length && <div className="field"><span className="field-label">Your recent foods</span>
        <div className="chips">{recent.map(r => <Chip key={r.name} onClick={() => pick(r.name, r.kcal, 'recent')}>{r.name}{!hide && r.kcal != null && <b>{r.kcal}</b>}</Chip>)}</div></div>}
      {!cur && <div className="field"><span className="field-label">Quick picks {!hide && <em>typical estimates</em>}</span>
        <div className="chips">{QUICK_PICKS.map(q => <Chip key={q.name} onClick={() => pick(q.name, q.kcal, 'pick')}>{q.name}{!hide && <b>{q.kcal}</b>}</Chip>)}</div></div>}
      <When value={when} onChange={setWhen} tz={tz} />
      {err && <div className="alert error" role="alert">{err}</div>}
      <button className="btn primary block">{cur ? 'Save' : 'Add'}</button>
      {cur && <DeleteButton table="food" id={cur.food_id} label="Food" onDone={onDone} />}
    </form>
  );
}

const MINUTES = [5, 10, 15, 20, 30, 45];
function MoveForm({ me, id, onDone }: { me: Me; id?: string; onDone: () => void }) {
  const toast = useToast(); const tz = me.settings.timezone;
  const cur = id ? (getState().move[id] as MoveEntry | undefined) : undefined;
  const [kind, setKind] = useState<MoveKind>(cur?.kind ?? 'walk');
  const [mins, setMins] = useState(String(cur?.minutes ?? 20));
  const [when, setWhen] = useState(toLocalInput(cur?.at ?? new Date(), tz));
  const [err, setErr] = useState<string | null>(null);
  const save = (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const m = Number(mins); if (!Number.isInteger(m) || m < 1 || m > 600) return setErr('Minutes should be between 1 and 600.');
    let at: string; try { at = parseWhen(when, tz); } catch (e: any) { return setErr(e.message); }
    if (cur) { updateEntry('move', cur.move_id, { kind, minutes: m, at }); toast('Saved'); }
    else { addEntry('move', { kind, minutes: m, at }); toast('Nice, movement logged'); }
    onDone();
  };
  return (
    <form onSubmit={save} style={{ display: 'contents' }}>
      <div className="field"><span className="field-label">What did you do?</span>
        <div className="chips" role="radiogroup" aria-label="Kind of movement">{MOVE_KINDS.map(k => <Chip key={k.value} on={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</Chip>)}</div></div>
      <div className="field"><span className="field-label">How long?</span>
        <div className="chips">{MINUTES.map(m => <Chip key={m} on={mins === String(m)} onClick={() => setMins(String(m))}>{m} min</Chip>)}</div>
        <input aria-label="Minutes" inputMode="numeric" value={mins} onChange={e => setMins(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} style={{ maxWidth: '8rem' }} />
      </div>
      <When value={when} onChange={setWhen} tz={tz} />
      <p className="tiny muted">Every bit counts, including a walk to the shop. If you’re unsure what’s right for your recovery, check with your midwife or doctor.</p>
      {err && <div className="alert error" role="alert">{err}</div>}
      <button className="btn primary block">{cur ? 'Save' : 'Add'}</button>
      {cur && <DeleteButton table="move" id={cur.move_id} label="Movement" onDone={onDone} />}
    </form>
  );
}

function WaterPanel({ me, id, onDone }: { me: Me; id?: string; onDone: () => void }) {
  const toast = useToast(); const s = me.settings; const tz = s.timezone;
  const d = dayData(me.all, todayKey(tz), tz); const n = glassesOf(d.water);
  const glass = id ? (getState().water[id] as WaterEntry | undefined) : undefined;
  if (glass && !glass.deleted_at) return (
    <>
      <p className="muted">Glass of water at {formatTime(glass.at, tz)} · {glass.ml} ml</p>
      <DeleteButton table="water" id={glass.water_id} label="Glass" onDone={onDone} />
    </>
  );
  return (
    <>
      <p className="muted">{n} of {s.water_goal} glasses today · {s.glass_ml} ml each</p>
      <div className="btn-row">
        <button className="btn soft" disabled={!n} onClick={() => { const rid = removeGlass(d); if (rid) toast('Glass removed', { label: 'Undo', run: () => restoreEntry('water', rid) }); }}>− 1</button>
        <button className="btn primary" style={{ flex: 2 }} onClick={() => { addGlass(s); toast(n + 1 === s.water_goal ? 'Water goal reached' : 'Glass logged'); }}>+ 1 glass</button>
      </div>
      <button className="link small" style={{ alignSelf: 'center' }} onClick={onDone}>Done</button>
    </>
  );
}

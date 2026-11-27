// Local-first data store (single user: everything here belongs to the signed-in account).
// - Every change is applied in memory at once (instant feedback, works offline), saved to IndexedDB in the
//   background and, with cloud sync, put in an outbox that sync (supabase.ts) sends to the server.
// - Client-generated UUIDs + upserts mean a retried change never creates a duplicate entry.
// - The outbox keeps one op per row (the newest version), so a row edited five times offline uploads once.
// - Deletes are soft (deleted_at), so they reach her other devices. Undo restores the row.
// - Last write wins per row, decided on updated_at, with the server's copy taking over once it has moved on.

import { useSyncExternalStore, useRef } from 'react';
import type { Persist } from './idb';
import type { Settings, FoodEntry, WaterEntry, MoveEntry, EntryTable, EntryOf, Profile } from './types';
import { ID_FIELD } from './types';
import { guessTimezone } from './time';

export type SyncTable = EntryTable | 'settings' | 'profile';
export interface OutboxOp { op_id: string; table: SyncTable; row: any; queued_at: string }
export interface FailedOp extends OutboxOp { error: string; failed_at: string }
interface LocalAccount { user_id: string; email: string; salt: string; hash: string; display_name: string }

export interface State {
  loaded: boolean;
  session: { user_id: string; email: string } | null;
  profiles: Record<string, Profile>;
  settings: Record<string, Settings>;
  food: Record<string, FoodEntry>;
  water: Record<string, WaterEntry>;
  move: Record<string, MoveEntry>;
  outbox: OutboxOp[];
  failed: FailedOp[];            // refused by the server: kept for retry, never silently lost
  lastSyncedAt: string | null;
  initialPullDone: boolean;
  accounts: Record<string, LocalAccount>; // local mode only (by email); Supabase Auth replaces this
  saveError: string | null;      // IndexedDB refused a save (shown as a warning)
  reauth: string | null;         // the server session ended: sign in again (nothing on the device is lost)
}

const META_KEYS = ['session', 'profiles', 'settings', 'outbox', 'failed', 'lastSyncedAt', 'accounts'] as const;
type MetaKey = typeof META_KEYS[number];

export const uuid = () => (crypto as any).randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
export const nowIso = () => new Date().toISOString();

const empty = (): State => ({
  loaded: false, session: null, profiles: {}, settings: {}, food: {}, water: {}, move: {}, outbox: [], failed: [],
  lastSyncedAt: null, initialPullDone: false, accounts: {}, saveError: null, reauth: null,
});

let state: State = empty();
let persist: Persist | null = null;
const listeners = new Set<() => void>();
let dirty: { store: string; key: string; value: any }[] = [];
let flushQueued = false;

export function getState() { return state; }
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const emit = () => listeners.forEach(l => l());

/** Loads what this device holds. The app shows a loading screen until this resolves. */
export async function initStore(p: Persist, beforeReady?: () => void) {
  persist = p;
  let loaded: Record<string, Record<string, any>> = {};
  let saveError: string | null = null;
  try { loaded = await p.load(); }
  catch { saveError = 'This browser isn’t letting Momig save on this device (private browsing?). What you log now may be lost when you close it.'; }
  const meta = loaded.meta || {};
  state = {
    ...empty(), loaded: true, saveError,
    food: loaded.food || {}, water: loaded.water || {}, move: loaded.move || {},
    session: meta.session ?? null, profiles: meta.profiles ?? {}, settings: meta.settings ?? {},
    outbox: meta.outbox ?? [], failed: meta.failed ?? [], lastSyncedAt: meta.lastSyncedAt ?? null, accounts: meta.accounts ?? {},
  };
  beforeReady?.(); // e.g. start sync, so cloud sign-in is set up before any screen can use it
  emit();
}

function flush() {
  if (flushQueued) return; flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    const batch = dirty; dirty = [];
    emit();
    if (!persist || !batch.length) return;
    // later writes to the same key win within a batch
    const last = new Map<string, typeof batch[number]>(); for (const c of batch) last.set(c.store + '\u0000' + c.key, c);
    persist.save([...last.values()]).then(
      () => { if (state.saveError && state.saveError.startsWith('Couldn’t save')) { state = { ...state, saveError: null }; emit(); } },
      () => { state = { ...state, saveError: 'Couldn’t save on this device. The phone may be low on storage. Free up some space, then log again.' }; emit(); },
    );
  });
}
function setMeta<K extends MetaKey>(k: K, v: State[K]) { state = { ...state, [k]: v }; dirty.push({ store: 'meta', key: k, value: v }); flush(); }
function putRow<T extends EntryTable>(t: T, row: EntryOf<T>) {
  const id = (row as any)[ID_FIELD[t]] as string;
  state = { ...state, [t]: { ...(state[t] as any), [id]: row } };
  dirty.push({ store: t, key: id, value: row }); flush();
}
function dropRow(t: EntryTable, id: string) {
  const next = { ...(state[t] as any) }; delete next[id];
  state = { ...state, [t]: next };
  dirty.push({ store: t, key: id, value: undefined }); flush();
}
/** Transient fields (not saved on the device). */
export function setTransient(patch: Partial<Pick<State, 'initialPullDone' | 'reauth' | 'saveError'>>) { state = { ...state, ...patch }; emit(); }
export const isInitialPullDone = () => state.initialPullDone;

export function useStore<T>(selector: (s: State) => T): T {
  // memoised by state identity, so selectors may return fresh arrays safely
  const cache = useRef<{ s: State | null; v: T }>({ s: null, v: undefined as any });
  const get = () => { if (cache.current.s !== state) cache.current = { s: state, v: selector(state) }; return cache.current.v; };
  return useSyncExternalStore(subscribe, get, get);
}

// ---------------- Auth ----------------

export interface AuthUser { user_id: string; email: string; display_name: string }
export interface RemoteAuth {
  register(email: string, password: string, display_name: string, captchaToken?: string): Promise<AuthUser>;
  signIn(email: string, password: string, captchaToken?: string): Promise<AuthUser>;
  reset(email: string, captchaToken?: string): Promise<void>;
  resetWithCode(email: string, code: string, password: string): Promise<AuthUser>;
  confirmSignup(email: string, code: string): Promise<AuthUser>;
  resendSignup(email: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  onSignedIn(): void;
}
let remote: RemoteAuth | null = null;
export function setRemoteAuth(r: RemoteAuth | null) { remote = r; }
export const isRemote = () => !!remote;

export const currentUserId = (s: State = state) => s.session?.user_id ?? null;
export const PASSWORD_RULE = 'Password must be at least 8 characters, include upper and lower case letters, a number, and a symbol.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashPw(pw: string, salt: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Signed in (by either mode): remember the session, and make sure there's a profile and settings row. */
export function adoptUser(u: AuthUser) {
  const email = u.email.toLowerCase();
  setMeta('session', { user_id: u.user_id, email });
  if (!state.profiles[u.user_id]) setMeta('profiles', { ...state.profiles, [u.user_id]: { user_id: u.user_id, email, display_name: u.display_name } });
  if (state.reauth) setTransient({ reauth: null });
  remote?.onSignedIn();
}

/** Cloud sign-in as someone else than the account this device last held (after "sign in again"): start clean. */
async function adoptRemote(u: AuthUser) {
  if (state.session && state.session.user_id !== u.user_id) await wipeDevice();
  adoptUser(u);
}

export async function register(email: string, password: string, display_name: string, captchaToken?: string) {
  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email address.');
  if (password.length < 8) throw new Error(PASSWORD_RULE);
  display_name = display_name.trim().slice(0, 80);
  if (remote) return adoptRemote(await remote.register(email, password, display_name, captchaToken));
  if (state.accounts[email]) throw new Error('An account with this email already exists.');
  const user_id = uuid(); const salt = uuid();
  setMeta('accounts', { ...state.accounts, [email]: { user_id, email, salt, hash: await hashPw(password, salt), display_name } });
  adoptUser({ user_id, email, display_name });
}

export async function signIn(email: string, password: string, captchaToken?: string) {
  email = email.trim().toLowerCase();
  if (remote) return adoptRemote(await remote.signIn(email, password, captchaToken));
  const a = state.accounts[email];
  if (!a || (await hashPw(password, a.salt)) !== a.hash) throw new Error('Email or password is incorrect.');
  adoptUser({ user_id: a.user_id, email, display_name: a.display_name });
}

/** When the project asks new accounts to confirm their email: the code from that email signs her in. */
export async function confirmSignup(email: string, code: string) {
  if (!remote) throw new Error('Not available in local mode.');
  if (!/^\d{6,10}$/.test(code.replace(/\s/g, ''))) throw new Error('Please enter the code from the email.');
  await adoptRemote(await remote.confirmSignup(email.trim().toLowerCase(), code));
}
export const NEEDS_CONFIRMATION = 'needs_confirmation';
export async function resendSignupCode(email: string) { if (remote) await remote.resendSignup(email.trim().toLowerCase()); }

export async function resetPassword(email: string, captchaToken?: string) {
  if (!remote) throw new Error('Password reset needs the live app (local mode has no email).');
  await remote.reset(email.trim().toLowerCase(), captchaToken);
}
export async function resetPasswordWithCode(email: string, code: string, newPassword: string) {
  if (!remote) throw new Error('Not available in local mode.');
  if (!/^\d{6,10}$/.test(code.replace(/\s/g, ''))) throw new Error('Please enter the code from the email.');
  if (newPassword.length < 8) throw new Error(PASSWORD_RULE);
  await adoptRemote(await remote.resetWithCode(email.trim().toLowerCase(), code, newPassword));
}

/** Clears everything on this device (cloud mode: the data lives on the server; never leave it on a shared phone). */
async function wipeDevice(keepAccounts = false) {
  const accounts = keepAccounts ? state.accounts : {};
  state = { ...empty(), loaded: true, accounts };
  dirty = [];
  try { await persist?.clear(); if (keepAccounts) await persist?.save([{ store: 'meta', key: 'accounts', value: accounts }]); } catch { /* nothing to keep */ }
  emit();
}

export async function signOut() {
  if (remote) { await remote.signOut().catch(() => {}); await wipeDevice(); return; }
  setMeta('session', null); // local mode: other local accounts keep their data on this device
}

export async function deleteAccount() {
  const uid = currentUserId(); if (!uid) return;
  if (remote) { await remote.deleteAccount(); await wipeDevice(); return; }
  const email = state.session!.email;
  for (const t of ['food', 'water', 'move'] as const) for (const r of Object.values(state[t] as Record<string, any>)) if (r.created_by === uid) dropRow(t, r[ID_FIELD[t]]);
  const { [email]: _a, ...accounts } = state.accounts; setMeta('accounts', accounts);
  const { [uid]: _s, ...settings } = state.settings; setMeta('settings', settings);
  const { [uid]: _p, ...profiles } = state.profiles; setMeta('profiles', profiles);
  setMeta('session', null);
}

/** The server session is gone (e.g. expired): ask her to sign in again; what's on the device stays and syncs after. */
export function requireReauth(message: string) { setTransient({ reauth: message }); }

// ---------------- Outbox ----------------

function queue(table: SyncTable, row: any, key: string) {
  if (!remote) return; // local mode: nothing to send
  const op: OutboxOp = { op_id: uuid(), table, row: structuredClone(row), queued_at: nowIso() };
  const idOf = (o: OutboxOp) => o.table === 'settings' || o.table === 'profile' ? o.table : o.row[ID_FIELD[o.table as EntryTable]];
  setMeta('outbox', [...state.outbox.filter(o => !(o.table === table && idOf(o) === key)), op]);
  // a newer version supersedes a refused older one
  if (state.failed.some(o => o.table === table && idOf(o) === key)) setMeta('failed', state.failed.filter(o => !(o.table === table && idOf(o) === key)));
}
/** Sync: the op reached the server. (If the row changed again meanwhile, a newer op is already waiting.) */
export function ackOp(op_id: string) { if (state.outbox.some(o => o.op_id === op_id)) setMeta('outbox', state.outbox.filter(o => o.op_id !== op_id)); }
export function failOp(op: OutboxOp, error: string) {
  setMeta('outbox', state.outbox.filter(o => o.op_id !== op.op_id));
  setMeta('failed', [...state.failed, { ...op, error, failed_at: nowIso() }].slice(-200));
}
/** Refused changes go back in the queue with the row as it is now (never an outdated copy). */
export function retryFailed() {
  if (!state.failed.length) return;
  const failed = state.failed; setMeta('failed', []);
  for (const f of failed) {
    if (f.table === 'settings') { const s = mySettings(); if (s) queue('settings', s, 'settings'); continue; }
    if (f.table === 'profile') { const p = myProfile(); if (p) queue('profile', p, 'profile'); continue; }
    const t = f.table as EntryTable; const id = f.row[ID_FIELD[t]];
    const cur = (state[t] as Record<string, any>)[id];
    if (cur && !state.outbox.some(o => o.table === t && o.row[ID_FIELD[t]] === id)) queue(t, cur, id);
  }
}

// ---------------- Settings & profile ----------------

export const defaultSettings = (user_id: string): Settings => ({
  user_id, track_food: false, track_water: false, track_move: false, kcal_goal: null, gentle_notes: true, hide_numbers: false,
  water_goal: 8, glass_ml: 250, timezone: guessTimezone(), onboarded_at: null, updated_at: new Date(0).toISOString(),
});
export function mySettings(s: State = state): Settings | null { const id = currentUserId(s); return id ? s.settings[id] ?? null : null; }
export function myProfile(s: State = state): Profile | null { const id = currentUserId(s); return id ? s.profiles[id] ?? null : null; }

export function updateSettings(patch: Partial<Omit<Settings, 'user_id' | 'updated_at' | 'server_updated_at'>>) {
  const uid = currentUserId(); if (!uid) throw new Error('Not signed in');
  const next: Settings = { ...defaultSettings(uid), ...state.settings[uid], ...patch, user_id: uid, updated_at: nowIso() };
  setMeta('settings', { ...state.settings, [uid]: next });
  queue('settings', next, 'settings');
}
export function updateName(display_name: string) {
  const uid = currentUserId(); if (!uid) return;
  const p: Profile = { ...state.profiles[uid], user_id: uid, email: state.session!.email, display_name: display_name.trim().slice(0, 80), updated_at: nowIso() };
  setMeta('profiles', { ...state.profiles, [uid]: p });
  queue('profile', p, 'profile');
}

// ---------------- Entries ----------------

type NewFields<T extends EntryTable> = Omit<EntryOf<T>, 'created_by' | 'created_at' | 'updated_at' | 'deleted_at' | 'server_updated_at' | typeof ID_FIELD[T]>;

export function addEntry<T extends EntryTable>(t: T, fields: NewFields<T>, id = uuid()): string {
  const uid = currentUserId(); if (!uid) throw new Error('Not signed in');
  const now = nowIso();
  const row = { ...fields, [ID_FIELD[t]]: id, created_by: uid, created_at: now, updated_at: now, deleted_at: null } as unknown as EntryOf<T>;
  putRow(t, row); queue(t, row, id);
  return id;
}
export function updateEntry<T extends EntryTable>(t: T, id: string, patch: Partial<NewFields<T>>) {
  const cur = (state[t] as Record<string, any>)[id]; if (!cur) return;
  const { created_by: _a, created_at: _b, server_updated_at: _c, ...safe } = patch as any;
  const row = { ...cur, ...safe, [ID_FIELD[t]]: id, updated_at: nowIso() };
  putRow(t, row); queue(t, row, id);
}
export function deleteEntry(t: EntryTable, id: string) {
  const cur = (state[t] as Record<string, any>)[id]; if (!cur || cur.deleted_at) return;
  const at = nowIso(); const row = { ...cur, deleted_at: at, updated_at: at };
  putRow(t, row); queue(t, row, id);
}
export function restoreEntry(t: EntryTable, id: string) {
  const cur = (state[t] as Record<string, any>)[id]; if (!cur) return;
  const row = { ...cur, deleted_at: null, updated_at: nowIso() };
  putRow(t, row); queue(t, row, id);
}

/** Her live (not deleted) entries of one kind. */
export function live<T extends EntryTable>(t: T, s: State = state): EntryOf<T>[] {
  const uid = currentUserId(s);
  return Object.values(s[t] as Record<string, EntryOf<T>>).filter(r => r.created_by === uid && !r.deleted_at);
}

// ---------------- Applying the server's copy (used by sync) ----------------

const pendingIds = (t: SyncTable) => new Set([...state.outbox, ...state.failed].filter(o => o.table === t).map(o => t === 'settings' || t === 'profile' ? t : o.row[ID_FIELD[t as EntryTable]]));

/** Rows pulled from the server. A row with a change still waiting to upload keeps the device's copy until it's sent. */
export function applyServerRows<T extends EntryTable>(t: T, rows: any[]) {
  if (!rows.length) return;
  const pending = pendingIds(t); const idf = ID_FIELD[t];
  const next = { ...(state[t] as Record<string, any>) }; let changed = false;
  for (const r of rows) {
    const id = r[idf]; if (pending.has(id)) continue;
    const local = next[id];
    // The server copy wins unless it's the very version this device already has and a local edit is newer.
    const serverMoved = !local?.server_updated_at || new Date(r.server_updated_at) > new Date(local.server_updated_at);
    if (!local || serverMoved || new Date(r.updated_at) >= new Date(local.updated_at)) {
      if (t === 'food' && r.kcal != null) r.kcal = Number(r.kcal);
      next[id] = r; dirty.push({ store: t, key: id, value: r }); changed = true;
    }
  }
  if (changed) { state = { ...state, [t]: next }; flush(); }
}
export function applyServerSettings(row: Settings | null) {
  const uid = currentUserId(); if (!uid || !row || row.user_id !== uid || pendingIds('settings').size) return;
  const local = state.settings[uid];
  if (!local || !local.server_updated_at || new Date(row.updated_at) >= new Date(local.updated_at) || new Date(row.server_updated_at!) > new Date(local.server_updated_at))
    setMeta('settings', { ...state.settings, [uid]: row });
}
export function applyServerProfile(row: Profile | null) {
  const uid = currentUserId(); if (!uid || !row || row.user_id !== uid || pendingIds('profile').size) return;
  setMeta('profiles', { ...state.profiles, [uid]: { ...state.profiles[uid], ...row } });
}
export function setLastSynced(at: string) { setMeta('lastSyncedAt', at); }

/** Deleted rows are kept while the server may not know about the delete, then dropped after 30 days. */
export function pruneDeleted(now = Date.now()) {
  const pending = { food: pendingIds('food'), water: pendingIds('water'), move: pendingIds('move') };
  for (const t of ['food', 'water', 'move'] as const)
    for (const r of Object.values(state[t] as Record<string, any>))
      if (r.deleted_at && r.server_updated_at && now - Date.parse(r.deleted_at) > 30 * 86400000 && !pending[t].has(r[ID_FIELD[t]])) dropRow(t, r[ID_FIELD[t]]);
}

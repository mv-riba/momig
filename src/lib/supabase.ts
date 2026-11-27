// Remote backend: Supabase (GoTrue auth + PostgREST), dependency-free fetch client (as in Bebig).
// - Pushes the outbox with idempotent upserts keyed by client UUIDs (no duplicates on retry).
// - Pulls each table in pages, ordered by (server_updated_at, id), from a cursor on the server's clock. The cursor
//   moves on only after the last page has arrived, so a migration touching every row can't leave a gap (Bebig QA H2).
// - Syncs every 15 s, on focus and when the connection comes back. No Realtime: one person's phones don't race.
// Row-level security in the database is the source of truth for access control.
import { config } from './config';
import {
  getState, subscribe, setRemoteAuth, currentUserId, ackOp, failOp, retryFailed, applyServerRows, applyServerSettings,
  applyServerProfile, setLastSynced, setTransient, requireReauth, pruneDeleted, PASSWORD_RULE, NEEDS_CONFIRMATION, type OutboxOp, type AuthUser,
} from './store';
import type { EntryTable } from './types';

const URL_ = config.supabaseUrl.replace(/\/$/, '');
const KEY = config.supabaseAnonKey;
const AUTH_KEY = 'momig:auth';
const CURSOR_KEY = 'momig:cursors';
export const PAGE = 1000;

interface AuthSession { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string; user_metadata?: any } }
const readStored = (): AuthSession | null => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; } };
let auth: AuthSession | null = readStored();
const saveAuth = (s: AuthSession | null) => { auth = s; try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch { /* */ } };
const toSession = (j: any): AuthSession => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, user: j.user });
const toUser = (s: AuthSession, name?: string): AuthUser => ({ user_id: s.user.id, email: s.user.email, display_name: name ?? s.user.user_metadata?.display_name ?? '' });

async function gotrue(path: string, body: any) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(weakPasswordMessage(j) || j.error_description || j.msg || j.message || 'Authentication failed');
  return j;
}
/** Supabase's own weak-password text lists every allowed character; show a short, friendly line instead. */
export function weakPasswordMessage(j: any): string | null {
  if (j?.error_code !== 'weak_password' && j?.code !== 'weak_password') return null;
  const reasons: string[] = j.weak_password?.reasons || [];
  if (reasons.includes('pwned')) return 'This password has appeared in a data leak. Please choose a different one.';
  if (reasons.includes('characters') || reasons.includes('length')) return PASSWORD_RULE;
  return 'Please choose a stronger password.';
}
const captcha = (t?: string) => t ? { gotrue_meta_security: { captcha_token: t } } : {};

// Refresh tokens are single use (Supabase rotates them): one refresh at a time per page, a cross-tab lock, and a
// re-read of storage in case another tab already refreshed. A dead session asks her to sign in again, keeping the outbox.
const fresher = (s: AuthSession | null) => !!s && !!auth && s.refresh_token !== auth.refresh_token && s.expires_at > Date.now() + 60000;
if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === AUTH_KEY) auth = readStored(); });
let refreshing: Promise<void> | null = null;
async function refresh() {
  const run = async () => {
    const stored = readStored();
    if (fresher(stored)) { auth = stored; return; }
    if (auth && auth.expires_at > Date.now() + 60000) return;
    try { saveAuth(toSession(await gotrue('token?grant_type=refresh_token', { refresh_token: auth!.refresh_token }))); }
    catch (e: any) {
      const again = readStored();
      if (fresher(again)) { auth = again; return; }
      if (/already used|invalid refresh token|refresh token not found|session.*(expired|not found)/i.test(e.message || '')) {
        saveAuth(null);
        requireReauth('Please sign in again — your session expired. Nothing you logged on this device is lost; it will sync after you sign in.');
      }
      throw e;
    }
  };
  const locks = (navigator as any).locks;
  return locks?.request ? locks.request('momig-auth-refresh', run) : run();
}
async function token(): Promise<string> {
  if (!auth) throw new Error('Not signed in');
  if (Date.now() > auth.expires_at - 60000) { refreshing ??= refresh().finally(() => { refreshing = null; }); await refreshing; }
  if (!auth) throw new Error('Not signed in');
  return auth.access_token;
}

async function rest(method: string, path: string, body?: any, prefer?: string) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { apikey: KEY, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && auth) auth = { ...auth, expires_at: 0 }; // force a refresh on the next call
  if (!r.ok) { const j = await r.json().catch(() => ({})); const e: any = new Error(j.message || `HTTP ${r.status}`); e.status = r.status; e.code = j.code; throw e; }
  return r.status === 204 || r.status === 201 ? null : r.json().catch(() => null);
}

export const REMOTE: Record<EntryTable, { table: string; id: string; columns: string[] }> = {
  food: { table: 'food_entries', id: 'food_id', columns: ['food_id', 'created_by', 'at', 'name', 'kcal', 'source', 'created_at', 'updated_at', 'deleted_at'] },
  water: { table: 'water_entries', id: 'water_id', columns: ['water_id', 'created_by', 'at', 'ml', 'created_at', 'updated_at', 'deleted_at'] },
  move: { table: 'move_entries', id: 'move_id', columns: ['move_id', 'created_by', 'at', 'kind', 'minutes', 'created_at', 'updated_at', 'deleted_at'] },
};
const SETTINGS_COLUMNS = ['user_id', 'track_food', 'track_water', 'track_move', 'kcal_goal', 'gentle_notes', 'hide_numbers', 'water_goal', 'glass_ml', 'timezone', 'onboarded_at', 'updated_at'];
const pick = (cols: string[], row: any) => Object.fromEntries(cols.filter(c => c in row).map(c => [c, row[c] ?? null]));

// ---------- push ----------
let pushing = false;
async function pushOne(op: OutboxOp) {
  if (op.table === 'settings') return rest('POST', 'settings?on_conflict=user_id', pick(SETTINGS_COLUMNS, op.row), 'resolution=merge-duplicates,return=minimal');
  if (op.table === 'profile') return rest('PATCH', `profiles?user_id=eq.${op.row.user_id}`, { display_name: op.row.display_name, updated_at: op.row.updated_at }, 'return=minimal');
  const R = REMOTE[op.table];
  return rest('POST', `${R.table}?on_conflict=${R.id}`, pick(R.columns, op.row), 'resolution=merge-duplicates,return=minimal');
}
async function push() {
  if (pushing || !auth || !navigator.onLine) return; pushing = true;
  try {
    while (true) {
      const op = getState().outbox[0]; if (!op) break;
      try { await pushOne(op); ackOp(op.op_id); }
      catch (e: any) {
        // refused (validation / permission): park it so the queue isn't blocked, keep it for retry and tell her
        if (e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) { console.warn('Sync refused', op, e); failOp(op, e.message); }
        else throw e;
      }
    }
  } finally { pushing = false; }
}

// ---------- pull ----------
type Cursor = { ts: string; id: string };
const readCursors = (): Partial<Record<EntryTable, Cursor>> => { try { return JSON.parse(localStorage.getItem(CURSOR_KEY) || '{}'); } catch { return {}; } };
const saveCursors = (c: Partial<Record<EntryTable, Cursor>>) => { try { localStorage.setItem(CURSOR_KEY, JSON.stringify(c)); } catch { /* */ } };

/** PostgREST filter for rows after (ts, id) in (server_updated_at, id) order. */
export function afterFilter(ts: string, id: string, idCol: string) {
  // values are double-quoted inside or(): a timestamp holds ':' '.' and '+'
  const t = encodeURIComponent(ts), q = encodeURIComponent(`"${ts}"`);
  return id ? `or=(server_updated_at.gt.${q},and(server_updated_at.eq.${q},${idCol}.gt.${id}))` : `server_updated_at=gte.${t}`;
}
/** Pulls one table page by page. `fetchPage` is injectable for tests. Returns the new cursor (or the old one). */
export async function pullTable(t: EntryTable, from: Cursor | undefined, fetchPage: (q: string) => Promise<any[]>, apply: (rows: any[]) => void): Promise<Cursor | undefined> {
  const R = REMOTE[t];
  // Start 5 minutes before the cursor: a write that committed late can carry an earlier server time. Rows seen twice merge harmlessly.
  let ts = from ? new Date(Date.parse(from.ts) - 5 * 60000).toISOString() : '', id = '';
  let newest = from;
  for (let page = 0; page < 10000; page++) {
    const q = `${R.table}?select=*${ts ? '&' + afterFilter(ts, id, R.id) : ''}&order=server_updated_at.asc,${R.id}.asc&limit=${PAGE}`;
    const rows = await fetchPage(q);
    apply(rows);
    if (rows.length) {
      const last = rows[rows.length - 1]; ts = last.server_updated_at; id = last[R.id];
      if (!newest || last.server_updated_at > newest.ts || (last.server_updated_at === newest.ts && id > newest.id)) newest = { ts, id };
    }
    if (rows.length < PAGE) return newest; // that was the last page: only now does the cursor move
  }
  return from;
}

const tableErrors: Partial<Record<string, string>> = {};
async function pull() {
  if (!auth || !navigator.onLine) return;
  const me = auth.user.id;
  const cursors = readCursors();
  const [settings, profile] = await Promise.all([
    rest('GET', `settings?user_id=eq.${me}&select=*`) as Promise<any[]>,
    rest('GET', `profiles?user_id=eq.${me}&select=user_id,email,display_name,updated_at`) as Promise<any[]>,
  ]);
  applyServerSettings(settings?.[0] ?? null);
  applyServerProfile(profile?.[0] ?? null);
  await Promise.all((Object.keys(REMOTE) as EntryTable[]).map(async t => {
    try {
      const c = await pullTable(t, cursors[t], q => rest('GET', q) as Promise<any[]>, rows => applyServerRows(t, rows));
      if (c) cursors[t] = c; delete tableErrors[t];
    } catch (e: any) { if (e.status === 401 || !navigator.onLine) throw e; tableErrors[t] = e.message; }
  }));
  saveCursors(cursors);
  pruneDeleted();
  setLastSynced(new Date().toISOString());
}

let syncError: string | null = null;
export const lastSyncError = () => syncError;
let running: Promise<void> | null = null; let again = false;
function cycle(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => { do { again = false; await cycleOnce(); } while (again); })().finally(() => { running = null; });
  return running;
}
async function cycleOnce() {
  try {
    await push(); await pull(); setTransient({ initialPullDone: true }); await push();
    const te = Object.entries(tableErrors);
    syncError = te.length ? `Some data couldn’t sync (${te.map(([t]) => t).join(', ')}): ${te[0][1]}` : null;
  } catch (e: any) {
    console.warn('sync', e);
    syncError = navigator.onLine ? (e?.message || 'Sync failed') : 'Offline';
    if (!navigator.onLine) setTransient({ initialPullDone: true });
  }
}
export const syncNow = () => cycle();

export function startRemoteSync() {
  setRemoteAuth({
    async register(email, password, display_name, captchaToken) {
      // consent was given on the sign-up form (the checkbox is required); the server records the time
      const j = await gotrue('signup', { email, password, data: { display_name, consent: 'true' }, ...captcha(captchaToken) });
      if (!j.access_token) throw new Error(NEEDS_CONFIRMATION); // email confirmation is on: the screen asks for the code
      const s = toSession(j); saveAuth(s); return toUser(s, display_name);
    },
    async signIn(email, password, captchaToken) {
      const s = toSession(await gotrue('token?grant_type=password', { email, password, ...captcha(captchaToken) })); saveAuth(s); return toUser(s);
    },
    async confirmSignup(email, code) {
      try { const s = toSession(await gotrue('verify', { type: 'signup', email, token: code.replace(/\s/g, '') })); saveAuth(s); return toUser(s); }
      catch { throw new Error('That code is wrong or has expired. Check the latest email from Momig.'); }
    },
    async resendSignup(email) { await gotrue('resend', { type: 'signup', email }); },
    async reset(email, captchaToken) { recovery = null; await gotrue('recover', { email, ...captcha(captchaToken) }); },
    // The reset email carries a code typed into the app, so she never has to leave it. A verified code is single use:
    // its session is kept so a refused password (too weak, same as before) can be retried without a new code.
    async resetWithCode(email, code, password) {
      if (!recovery || recovery.email !== email || recovery.s.expires_at < Date.now() + 30000) {
        try { recovery = { email, s: toSession(await gotrue('verify', { type: 'recovery', email, token: code.replace(/\s/g, '') })) }; }
        catch { throw new Error('That code is wrong or has expired. Check the latest email from Momig, or send a new code.'); }
      }
      const r = await fetch(`${URL_}/auth/v1/user`, { method: 'PUT', headers: { apikey: KEY, Authorization: `Bearer ${recovery.s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j?.error_code === 'same_password' || j?.code === 'same_password') throw new Error('That’s your current password. Choose a different one, or go back and sign in with it.');
        throw new Error(weakPasswordMessage(j) || 'Your password couldn’t be changed. Please try again.');
      }
      const s = recovery.s; recovery = null; saveAuth(s); return toUser(s);
    },
    async signOut() {
      try { await fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${auth?.access_token}` } }); } catch { /* offline */ }
      saveAuth(null); try { localStorage.removeItem(CURSOR_KEY); } catch { /* */ }
    },
    async deleteAccount() { await rest('POST', 'rpc/delete_my_account', {}); saveAuth(null); try { localStorage.removeItem(CURSOR_KEY); } catch { /* */ } },
    onSignedIn() { setTransient({ initialPullDone: false }); setTimeout(() => setTransient({ initialPullDone: true }), 12000); retryFailed(); cycle(); },
  });

  window.addEventListener('online', () => cycle());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cycle(); });
  // a change goes out within a second (debounced), not on the next 15-s tick
  let debounce: any; let seen = getState().outbox.length;
  subscribe(() => { const n = getState().outbox.length; if (n && n !== seen && auth && navigator.onLine) { clearTimeout(debounce); debounce = setTimeout(() => push().catch(() => {}), 600); } seen = n; });
  setInterval(() => cycle(), 15000);
  // changes the server refused (e.g. before a database update was run) are retried every 5 minutes
  setInterval(() => { if (auth && navigator.onLine && getState().failed.length) { retryFailed(); cycle(); } }, 5 * 60000);
  if (auth) { setTimeout(() => setTransient({ initialPullDone: true }), 12000); if (getState().failed.length) retryFailed(); cycle(); }
  else if (currentUserId()) requireReauth('Please sign in again to keep your log in sync. Nothing on this device is lost.');
}
let recovery: { email: string; s: AuthSession } | null = null;

/** Momig Plus status from the server (not used by the MVP screens yet). */
export async function plusStatus(): Promise<any | null> { try { return await rest('POST', 'rpc/plus_status', {}); } catch { return null; } }

export async function diagnostics(): Promise<string> {
  const s = getState(); const lines: string[] = [];
  lines.push(`Momig ${config.version} · cloud sync`);
  lines.push(`Signed in: ${auth ? auth.user.email : 'no server session'} · online: ${navigator.onLine}`);
  lines.push(`Last synced: ${s.lastSyncedAt ?? 'never'} · waiting: ${s.outbox.length} · refused: ${s.failed.length}`);
  for (const f of s.failed.slice(-3)) lines.push(`  refused ${f.table}: ${f.error}`);
  if (syncError) lines.push(`Last error: ${syncError}`);
  return lines.join('\n');
}

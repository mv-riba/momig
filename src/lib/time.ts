// Time-zone aware helpers. Storage is always UTC; everything she sees is in her IANA zone (settings.timezone).
// Handles DST correctly because conversion is done via Intl rather than fixed offsets.

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmtFor(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number }
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function zonedParts(date: Date | string | number, tz: string): ZonedParts {
  const d = new Date(date);
  const p: Record<string, string> = {};
  for (const x of fmtFor(tz).formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: WD[p.weekday] ?? 0 };
}

/** Offset (ms) of tz from UTC at the given instant. */
export function tzOffset(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in tz to a UTC Date. For DST gaps, rolls forward; for overlaps, picks the earlier instant. */
export function zonedToUtc(y: number, m: number, d: number, h = 0, mi = 0, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = tzOffset(new Date(guess), tz);
  let t = guess - off;
  const off2 = tzOffset(new Date(t), tz);
  if (off2 !== off) { t = guess - off2; }
  return new Date(t);
}

export const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(date: Date | string | number, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
export function parseKey(key: string) { const [y, m, d] = key.split('-').map(Number); return { y, m, d }; }
export function dayStart(key: string, tz: string): Date { const { y, m, d } = parseKey(key); return zonedToUtc(y, m, d, 0, 0, tz); }
export function addDays(key: string, n: number): string {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dayEnd(key: string, tz: string): Date { return dayStart(addDays(key, 1), tz); }
export function todayKey(tz: string) { return dateKey(new Date(), tz); }
export function daysBetween(a: string, b: string) {
  const A = parseKey(a), B = parseKey(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

export type TimeFormat = '24h' | '12h';
export function formatTime(iso: string | Date, tz: string, f: TimeFormat = '24h'): string {
  const p = zonedParts(iso, tz);
  if (f === '24h') return `${pad(p.h)}:${pad(p.mi)}`;
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${h12}:${pad(p.mi)} ${p.h < 12 ? 'am' : 'pm'}`;
}
export function minutesOfDay(iso: string | Date, tz: string) { const p = zonedParts(iso, tz); return p.h * 60 + p.mi; }
export function formatMinutesOfDay(min: number, f: TimeFormat = '24h') {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(min / 60), mi = min % 60;
  if (f === '24h') return `${pad(h)}:${pad(mi)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(mi)} ${h < 12 ? 'am' : 'pm'}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const monthName = (m: number) => MONTHS[m - 1];
export function formatDateKey(key: string, style: 'long' | 'short' | 'weekday' = 'long') {
  const { y, m, d } = parseKey(key);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  if (style === 'short') return `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  if (style === 'weekday') return `${DAYS[wd].slice(0, 3)}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
  return `${DAYS[wd]}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}
export function weekdayIndex(key: string) { const { y, m, d } = parseKey(key); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }
export function daysInMonth(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function formatDuration(sec: number, compact = false): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (compact) return h ? `${h}h ${pad(m)}m` : `${m}m`;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  if (m) return `${m} min`;
  return sec < 60 ? `${sec} sec` : '0 min';
}
export function formatClock(sec: number) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export function formatAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** 'YYYY-MM-DDTHH:mm' in tz for <input type=datetime-local>. */
export function toLocalInput(iso: string | Date, tz: string) {
  const p = zonedParts(iso, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}
export function fromLocalInput(v: string, tz: string): string {
  const [date = '', time = '00:00'] = (v || '').split('T');
  const { y, m, d } = parseKey(date);
  const [h, mi] = time.split(':').map(Number);
  const t = [y, m, d, h, mi].every(Number.isFinite) ? zonedToUtc(y, m, d, h, mi, tz) : null;
  // a cleared date/time field: a readable message instead of "Invalid time value"
  if (!t || isNaN(t.getTime())) throw new Error('Please enter a valid date and time.');
  return t.toISOString();
}

export function guessTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
export function listTimezones(): string[] {
  try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['UTC', 'Europe/Amsterdam', 'Europe/Helsinki', 'Europe/London']; }
}


export function greeting(h: number) { return h < 5 ? 'Up in the night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
/** "Friday, 27 November" */
export function longDate(key: string) {
  const { y, m, d } = parseKey(key);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][wd]}, ${d} ${monthName(m)}`;
}
export const isValidTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

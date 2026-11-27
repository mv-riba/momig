// Paged pull (Bebig QA H2): every row arrives across pages, and the cursor only moves after the last page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
Object.assign(globalThis as any, { localStorage: mem() });
const { pullTable, afterFilter, PAGE, weakPasswordMessage } = await import('../src/lib/supabase.ts');

// a fake PostgREST over 2,500 rows, many sharing one server time (as after a migration touching every row)
const rows = Array.from({ length: 2500 }, (_, i) => ({ food_id: `id-${String(i).padStart(5, '0')}`, server_updated_at: i < 1800 ? '2026-11-27T10:00:00.000000+00:00' : `2026-11-27T11:${String(i % 60).padStart(2, '0')}:00.000000+00:00` }))
  .sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.food_id.localeCompare(b.food_id));
function fakeFetch(q: string) {
  const u = new URLSearchParams(q.split('?')[1]);
  let out = rows;
  const or = u.get('or');
  if (or) { const m = /server_updated_at\.gt\."([^"]+)",and\(server_updated_at\.eq\."([^"]+)",food_id\.gt\.([^)]+)\)/.exec(or)!; out = out.filter(r => r.server_updated_at > m[1] || (r.server_updated_at === m[2] && r.food_id > m[3])); }
  const gte = u.get('server_updated_at'); if (gte) { const ts = gte.replace('gte.', ''); out = out.filter(r => r.server_updated_at >= ts); }
  return Promise.resolve(out.slice(0, Number(u.get('limit'))));
}

test('every row arrives once, across pages, even when hundreds share a timestamp', async () => {
  const seen: string[] = []; let pages = 0;
  const c = await pullTable('food', undefined, q => { pages++; return fakeFetch(q); }, r => seen.push(...r.map(x => x.food_id)));
  assert.equal(new Set(seen).size, 2500); assert.equal(seen.length, 2500);
  assert.equal(pages, Math.ceil(2500 / PAGE) + (2500 % PAGE === 0 ? 1 : 0));
  assert.equal(c!.id, rows[rows.length - 1].food_id);
});

test('the cursor stays put if a page fails part way', async () => {
  let n = 0;
  await assert.rejects(pullTable('food', undefined, q => (++n === 2 ? Promise.reject(new Error('offline')) : fakeFetch(q)), () => {}));
});

test('later pulls start a little before the cursor, so a late commit isn’t missed', async () => {
  const qs: string[] = [];
  await pullTable('food', { ts: '2026-11-27T11:30:00.000000+00:00', id: 'id-x' }, q => { qs.push(q); return Promise.resolve([]); }, () => {});
  assert.match(decodeURIComponent(qs[0]), /server_updated_at=gte\.2026-11-27T11:25:00/);
});

test('keyset filter and friendly password messages', () => {
  assert.match(afterFilter('2026-11-27T10:00:00+00:00', 'abc', 'food_id'), /^or=\(server_updated_at\.gt\..+,and\(server_updated_at\.eq\..+,food_id\.gt\.abc\)\)$/);
  assert.match(weakPasswordMessage({ error_code: 'weak_password', weak_password: { reasons: ['pwned'] } })!, /data leak/);
  assert.equal(weakPasswordMessage({ error_code: 'other' }), null);
});

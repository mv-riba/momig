// The sign-in code step survives a reload, and a new version never reloads the app while she's fetching the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPendingCode, savePendingCode, clearPendingCode, PENDING_MAX_AGE } from '../src/lib/pendingCode.ts';
import { holdReload, reloadHeld, reloadWhenAllowed } from '../src/lib/reload.ts';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };

test('a code step comes back after a reload, with her email', () => {
  const s = mem();
  savePendingCode('confirm', ' Anna@X.fi ', 1000, s);
  assert.deepEqual(readPendingCode(2000, s), { mode: 'confirm', email: 'anna@x.fi', at: 1000 });
  savePendingCode('reset', 'anna@x.fi', 3000, s);
  assert.equal(readPendingCode(4000, s)!.mode, 'reset');
});

test('an old code step (codes expire after an hour) or a cleared one is gone', () => {
  const s = mem();
  savePendingCode('confirm', 'anna@x.fi', 0, s);
  assert.equal(readPendingCode(PENDING_MAX_AGE + 1, s), null);
  assert.equal(s.getItem('momig:pending-code'), null, 'dropped from the device');
  savePendingCode('confirm', 'anna@x.fi', 0, s); clearPendingCode(s);
  assert.equal(readPendingCode(1, s), null);
});

test('junk in storage is ignored', () => {
  const s = mem();
  for (const v of ['{', '{"mode":"signin","email":"a@x.fi","at":1}', '{"mode":"confirm","email":"","at":1}', '{"mode":"confirm","email":"a@x.fi"}'])
  { s.setItem('momig:pending-code', v); assert.equal(readPendingCode(2, s), null, v); }
  assert.equal(readPendingCode(0, null), null, 'no storage at all');
});

test('a reload waits until every hold is released', () => {
  let reloads = 0;
  const a = holdReload(), b = holdReload();
  reloadWhenAllowed(() => reloads++);
  assert.equal(reloads, 0); assert.ok(reloadHeld());
  a(); a(); // releasing twice counts once
  assert.equal(reloads, 0);
  b();
  assert.equal(reloads, 1); assert.ok(!reloadHeld());
  reloadWhenAllowed(() => reloads++);
  assert.equal(reloads, 2, 'with no hold it runs at once');
});

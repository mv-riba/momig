// Local-first store: saved to IndexedDB (here an in-memory stand-in), queued once per row, safe to undo and retry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPersist } from '../src/lib/idb.ts';

const store = await import('../src/lib/store.ts');
const tick = () => new Promise(r => setTimeout(r, 5));
const p = memoryPersist();
await store.initStore(p);

// a pretend server: sign-in works, nothing is sent (the outbox is inspected instead)
store.setRemoteAuth({
  async register(email: string, _pw: string, display_name: string) { return { user_id: 'u1', email, display_name }; },
  async signIn(email: string) { return { user_id: email === 'b@x.fi' ? 'u2' : 'u1', email, display_name: '' }; },
  async reset() {}, async resetWithCode(email: string) { return { user_id: 'u1', email, display_name: '' }; },
  async confirmSignup(email: string) { return { user_id: 'u1', email, display_name: '' }; }, async resendSignup() {},
  async signOut() {}, async deleteAccount() {}, onSignedIn() {},
});
await store.register('A@x.fi', 'Password1!', 'Anna');

test('signing in remembers her and starts with every tracker off', () => {
  assert.equal(store.currentUserId(), 'u1');
  assert.equal(store.getState().session!.email, 'a@x.fi');
  assert.equal(store.mySettings(), null, 'settings come from onboarding (or the server)');
});

test('an entry is saved on the device and queued once, however often it changes', async () => {
  const id = store.addEntry('food', { at: '2026-11-27T08:00:00Z', name: 'Porridge', kcal: 250, source: 'pick' });
  store.updateEntry('food', id, { kcal: 300 });
  store.updateEntry('food', id, { name: 'Porridge with milk' });
  const ops = store.getState().outbox.filter(o => o.table === 'food' && o.row.food_id === id);
  assert.equal(ops.length, 1); assert.equal(ops[0].row.kcal, 300); assert.equal(ops[0].row.name, 'Porridge with milk');
  await tick();
  assert.equal(p.data.food[id].name, 'Porridge with milk', 'written to the device store');
  assert.equal(p.data.meta.outbox.length, store.getState().outbox.length, 'the outbox survives a restart');
});

test('created_by and created_at can’t be changed by an edit', () => {
  const id = store.addEntry('move', { at: '2026-11-27T09:00:00Z', kind: 'walk', minutes: 20 });
  const before = store.getState().move[id];
  store.updateEntry('move', id, { created_by: 'someone', created_at: '2000-01-01' } as any);
  assert.equal(store.getState().move[id].created_by, 'u1'); assert.equal(store.getState().move[id].created_at, before.created_at);
});

test('delete is soft and undo restores it', () => {
  const id = store.addEntry('water', { at: '2026-11-27T10:00:00Z', ml: 250 });
  store.deleteEntry('water', id);
  assert.ok(!store.live('water').some(w => w.water_id === id));
  assert.ok(store.getState().outbox.some(o => o.table === 'water' && o.row.water_id === id && o.row.deleted_at), 'the delete syncs');
  store.restoreEntry('water', id);
  assert.ok(store.live('water').some(w => w.water_id === id));
});

test('a refused change is retried with the row as it is now', () => {
  const id = store.addEntry('food', { at: '2026-11-27T11:00:00Z', name: 'Toast', kcal: 150, source: 'manual' });
  const op = store.getState().outbox.find(o => o.row.food_id === id)!;
  store.failOp(op, 'refused');
  assert.equal(store.getState().failed.length, 1);
  store.updateEntry('food', id, { kcal: 160 });
  assert.equal(store.getState().failed.length, 0, 'a newer version replaces the refused one');
  const op2 = store.getState().outbox.find(o => o.row.food_id === id)!;
  store.failOp(op2, 'refused'); store.retryFailed();
  assert.equal(store.getState().outbox.find(o => o.row.food_id === id)!.row.kcal, 160);
});

test('ack only removes the op that was sent, not a newer one for the same row', () => {
  const id = store.addEntry('food', { at: '2026-11-27T12:00:00Z', name: 'Apple', kcal: 95, source: 'pick' });
  const sent = store.getState().outbox.find(o => o.row.food_id === id)!;
  store.updateEntry('food', id, { kcal: 100 }); // changed while the first upload was on its way
  store.ackOp(sent.op_id);
  assert.equal(store.getState().outbox.find(o => o.row.food_id === id)?.row.kcal, 100);
});

test('server rows: a waiting local change wins, otherwise the newer server copy is taken', () => {
  const id = store.addEntry('move', { at: '2026-11-27T13:00:00Z', kind: 'yoga', minutes: 10 });
  store.applyServerRows('move', [{ ...store.getState().move[id], minutes: 99, server_updated_at: '2026-11-27T13:01:00Z', updated_at: '2030-01-01T00:00:00Z' }]);
  assert.equal(store.getState().move[id].minutes, 10, 'not yet uploaded: the device copy stays');
  for (const o of store.getState().outbox) store.ackOp(o.op_id);
  store.applyServerRows('move', [{ ...store.getState().move[id], minutes: 30, server_updated_at: '2026-11-27T14:00:00Z', updated_at: '2026-11-27T14:00:00Z' }]);
  assert.equal(store.getState().move[id].minutes, 30);
});

test('settings: onboarding writes them; switching a tracker off keeps its entries', () => {
  store.updateSettings({ track_food: true, track_water: true, track_move: false, onboarded_at: '2026-11-27T08:00:00Z' });
  const n = store.live('food').length;
  store.updateSettings({ track_food: false });
  assert.equal(store.live('food').length, n);
  assert.equal(store.getState().outbox.filter(o => o.table === 'settings').length, 1);
});

test('signing out of the cloud account wipes this device; another account starts clean', async () => {
  await store.signOut(); await tick();
  assert.equal(store.getState().session, null);
  assert.equal(Object.keys(store.getState().food).length, 0);
  assert.equal(Object.keys(p.data.food).length, 0);
  await store.signIn('b@x.fi', 'x');
  assert.equal(store.live('food').length, 0);
});

test('a failed device save is reported, not silently lost', async () => {
  const bad = memoryPersist(); bad.save = async () => { throw new Error('QuotaExceededError'); };
  await store.initStore(bad);
  await store.signIn('b@x.fi', 'x');
  store.addEntry('food', { at: '2026-11-27T08:00:00Z', name: 'x', kcal: null, source: 'manual' });
  await tick();
  assert.match(store.getState().saveError ?? '', /Couldn’t save/);
});

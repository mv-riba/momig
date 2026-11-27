// Today and Week calculations: day boundaries in her time zone, totals, gentle notes, Hide numbers, small wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayData, kcalOf, minutesOf, foodNote, timeline, recentFoods, week, smallWins } from '../src/lib/calc.ts';
import type { FoodEntry, WaterEntry, MoveEntry } from '../src/lib/types.ts';

const base = { created_by: 'u', created_at: '', updated_at: '', deleted_at: null };
const food = (id: string, at: string, name: string, kcal: number | null): FoodEntry => ({ ...base, food_id: id, at, name, kcal, source: 'manual' });
const water = (id: string, at: string): WaterEntry => ({ ...base, water_id: id, at, ml: 250 });
const move = (id: string, at: string, minutes: number, kind: MoveEntry['kind'] = 'walk'): MoveEntry => ({ ...base, move_id: id, at, kind, minutes });
const TZ = 'Europe/Helsinki';
const S = { track_food: true, track_water: true, track_move: true, hide_numbers: false, kcal_goal: 2000, gentle_notes: true, water_goal: 8 };

test('a day is her local day: 23:30 Helsinki on the 26th is not the 27th', () => {
  const all = { food: [food('a', '2026-11-26T21:30:00Z', 'Late snack', 200), food('b', '2026-11-26T22:30:00Z', 'Breakfast?', 300)], water: [], move: [] };
  assert.equal(kcalOf(dayData(all, '2026-11-26', TZ).food), 200);
  assert.equal(kcalOf(dayData(all, '2026-11-27', TZ).food), 300); // 00:30 local
});

test('food without calories counts as 0 kcal but still counts as an item', () => {
  assert.equal(kcalOf([food('a', '2026-11-27T10:00:00Z', 'Toast', null), food('b', '2026-11-27T11:00:00Z', 'Apple', 95)]), 95);
});

test('gentle notes: only with her own goal, notes on, numbers shown', () => {
  assert.equal(foodNote({ ...S, kcal_goal: null }, 3000, 20), null, 'no goal, no note');
  assert.equal(foodNote({ ...S, gentle_notes: false }, 3000, 20), null);
  assert.equal(foodNote({ ...S, hide_numbers: true }, 3000, 20), null, 'Hide numbers turns notes off');
  assert.equal(foodNote(S, 2400, 12)?.kind, 'over');
  assert.equal(foodNote(S, 900, 12), null, 'a low total before the evening is just an unfinished day');
  assert.equal(foodNote(S, 900, 19)?.kind, 'under');
  assert.equal(foodNote(S, 1900, 13)?.kind, 'ok');
  for (const k of [0, 900, 1900, 2400, 4000]) { const n = foodNote(S, k, 20); if (n) assert.doesNotMatch(n.text, /\d/, 'notes carry no numbers to chase'); }
});

test('timeline: newest first, only switched-on trackers, no calories with Hide numbers', () => {
  const d = { food: [food('f', '2026-11-27T08:00:00Z', 'Porridge', 250)], water: [water('w', '2026-11-27T09:00:00Z')], move: [move('m', '2026-11-27T10:00:00Z', 20, 'pram_walk')] };
  assert.deepEqual(timeline(d, S).map(i => i.kind), ['move', 'water', 'food']);
  assert.equal(timeline(d, S)[0].title, 'Pram walk');
  assert.equal(timeline(d, { ...S, track_water: false }).length, 2, 'a switched-off tracker keeps its data but shows nothing');
  const hidden = timeline(d, { ...S, hide_numbers: true }).find(i => i.kind === 'food')!;
  assert.doesNotMatch(hidden.sub, /kcal/);
});

test('recent foods: newest first, one per name, last 30 days only', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const r = recentFoods([food('a', '2026-11-27T08:00:00Z', 'Latte', 130), food('b', '2026-11-26T08:00:00Z', 'latte ', 150), food('c', '2026-11-25T08:00:00Z', 'Banana', 105), food('d', '2026-09-01T08:00:00Z', 'Old', 1)], now);
  assert.deepEqual(r, [{ name: 'Latte', kcal: 130 }, { name: 'Banana', kcal: 105 }]);
});

test('week: seven days ending today, oldest first; small wins only count good days', () => {
  const all = { food: [food('a', '2026-11-27T08:00:00Z', 'Porridge', 250)], water: Array.from({ length: 8 }, (_, i) => water('w' + i, `2026-11-25T0${i}:30:00Z`)), move: [move('m1', '2026-11-24T10:00:00Z', 25), move('m2', '2026-11-27T10:00:00Z', 15, 'yoga')] };
  const w = week(all, TZ, '2026-11-27');
  assert.equal(w.length, 7); assert.equal(w[0].key, '2026-11-21'); assert.ok(w[6].today);
  assert.equal(w[6].kcal, 250); assert.equal(w[4].glasses, 8); assert.equal(minutesOf(all.move), 40);
  assert.deepEqual(smallWins(w, S), ['You got outside on 1 day this week.', 'You reached your water goal on 1 day.']);
  assert.deepEqual(smallWins(week({ food: [], water: [], move: [] }, TZ, '2026-11-27'), S), [], 'an empty week says nothing, rather than something discouraging');
});

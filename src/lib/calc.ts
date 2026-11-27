// Pure, deterministic calculations for Today and Week (unit-tested). No judgement lives here: just sums,
// and the conditions for the few gentle notes she can switch off.
import type { FoodEntry, WaterEntry, MoveEntry, Settings } from './types';
import { moveLabel } from './types';
import { dateKey, addDays, todayKey, zonedParts, weekdayIndex } from './time';

export interface DayData { food: FoodEntry[]; water: WaterEntry[]; move: MoveEntry[] }
export const inDay = <T extends { at: string }>(rows: T[], key: string, tz: string) => rows.filter(r => dateKey(r.at, tz) === key);
export function dayData(all: DayData, key: string, tz: string): DayData {
  return { food: inDay(all.food, key, tz), water: inDay(all.water, key, tz), move: inDay(all.move, key, tz) };
}
export const kcalOf = (food: FoodEntry[]) => food.reduce((a, f) => a + (f.kcal ?? 0), 0);
export const minutesOf = (move: MoveEntry[]) => move.reduce((a, m) => a + m.minutes, 0);
export const glassesOf = (water: WaterEntry[]) => water.length;
export const litresOf = (water: WaterEntry[]) => water.reduce((a, w) => a + w.ml, 0) / 1000;

export type FoodNote = { kind: 'under' | 'over' | 'ok'; text: string } | null;
/** A gentle note about food, only when she set her own goal, kept notes on and doesn't hide numbers.
 *  "Under" only shows from 18:00 (earlier, a low total just means the day isn't over). Never red, never a number to chase. */
export function foodNote(s: Pick<Settings, 'kcal_goal' | 'gentle_notes' | 'hide_numbers'>, kcal: number, hour: number): FoodNote {
  const goal = s.kcal_goal;
  if (!goal || !s.gentle_notes || s.hide_numbers) return null;
  if (kcal > goal * 1.15) return { kind: 'over', text: 'You’re past the goal you set for today. One day doesn’t define anything. This is just so you know.' };
  if (hour >= 18 && kcal < goal * 0.6) return { kind: 'under', text: 'Busy days make it easy to forget to eat. Maybe a snack and a drink?' };
  if (kcal >= goal * 0.9) return { kind: 'ok', text: 'Right around your goal today.' };
  return null;
}

export interface TimelineItem { kind: 'food' | 'water' | 'move'; id: string; at: string; title: string; sub: string }
/** Newest first. With hide_numbers, food shows no calories. */
export function timeline(d: DayData, s: Pick<Settings, 'track_food' | 'track_water' | 'track_move' | 'hide_numbers'>): TimelineItem[] {
  const items: TimelineItem[] = [];
  if (s.track_food) for (const f of d.food) items.push({ kind: 'food', id: f.food_id, at: f.at, title: f.name, sub: s.hide_numbers ? 'Food' : f.kcal != null ? `${f.kcal} kcal` : 'Food' });
  if (s.track_water) for (const w of d.water) items.push({ kind: 'water', id: w.water_id, at: w.at, title: 'Glass of water', sub: `${w.ml} ml` });
  if (s.track_move) for (const m of d.move) items.push({ kind: 'move', id: m.move_id, at: m.at, title: moveLabel(m.kind), sub: `${m.minutes} min` });
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/** Her recent foods (last 30 days), newest first, one per name, with the calories she gave last time. */
export function recentFoods(food: FoodEntry[], now = Date.now(), max = 6): { name: string; kcal: number | null }[] {
  const seen = new Set<string>(); const out: { name: string; kcal: number | null }[] = [];
  for (const f of [...food].sort((a, b) => b.at.localeCompare(a.at))) {
    if (now - Date.parse(f.at) > 30 * 86400000) break;
    const k = f.name.trim().toLowerCase(); if (seen.has(k)) continue;
    seen.add(k); out.push({ name: f.name.trim(), kcal: f.kcal }); if (out.length >= max) break;
  }
  return out;
}

export interface WeekDay { key: string; label: string; today: boolean; kcal: number; foods: number; glasses: number; minutes: number; outside: boolean }
const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
/** The last 7 days, oldest first, ending today. */
export function week(all: DayData, tz: string, today = todayKey(tz)): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i); const d = dayData(all, key, tz);
    days.push({ key, label: WD[weekdayIndex(key)], today: i === 0, kcal: kcalOf(d.food), foods: d.food.length, glasses: glassesOf(d.water), minutes: minutesOf(d.move),
      outside: d.move.some(m => m.kind === 'walk' || m.kind === 'pram_walk') });
  }
  return days;
}

/** Small wins: only good news, only counted days (no streaks, nothing to lose). */
export function smallWins(days: WeekDay[], s: Pick<Settings, 'track_food' | 'track_water' | 'track_move' | 'water_goal'>): string[] {
  const wins: string[] = []; const n = (k: number) => `${k} day${k === 1 ? '' : 's'}`;
  if (s.track_move) { const out = days.filter(d => d.outside).length; if (out) wins.push(`You got outside on ${n(out)} this week.`); else { const m = days.filter(d => d.minutes).length; if (m) wins.push(`You moved on ${n(m)} this week.`); } }
  if (s.track_water) { const g = days.filter(d => d.glasses >= s.water_goal).length; if (g) wins.push(`You reached your water goal on ${n(g)}.`); }
  if (s.track_food) { const f = days.filter(d => d.foods).length; if (f >= 3) wins.push(`You found time to log meals on ${n(f)}.`); }
  return wins;
}

export const hourIn = (tz: string, at = new Date()) => zonedParts(at, tz).h;

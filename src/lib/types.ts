// Data model. Mirrors supabase/migrations/0001_init.sql (column names are the same on both sides).

export interface Settings {
  user_id: string;
  track_food: boolean; track_water: boolean; track_move: boolean;
  kcal_goal: number | null;       // her own number; never suggested
  gentle_notes: boolean;          // under/over notes (only with a goal, never with hide_numbers)
  hide_numbers: boolean;          // no calories anywhere
  water_goal: number;             // glasses a day
  glass_ml: number;
  timezone: string;
  onboarded_at: string | null;
  updated_at: string;
  server_updated_at?: string;
}

interface EntryBase {
  created_by: string;
  at: string;                     // when it happened (UTC ISO)
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  server_updated_at?: string;     // set by the server; absent = never confirmed by the server
}
export interface FoodEntry extends EntryBase { food_id: string; name: string; kcal: number | null; source: 'manual' | 'recent' | 'pick' }
export interface WaterEntry extends EntryBase { water_id: string; ml: number }
export type MoveKind = 'walk' | 'pram_walk' | 'stretching' | 'postnatal_class' | 'yoga' | 'other';
export interface MoveEntry extends EntryBase { move_id: string; kind: MoveKind; minutes: number }

export type EntryTable = 'food' | 'water' | 'move';
export type EntryOf<T extends EntryTable> = T extends 'food' ? FoodEntry : T extends 'water' ? WaterEntry : MoveEntry;
export const ID_FIELD = { food: 'food_id', water: 'water_id', move: 'move_id' } as const;

export interface Profile { user_id: string; email: string; display_name: string; updated_at?: string }

export const MOVE_KINDS: { value: MoveKind; label: string }[] = [
  { value: 'walk', label: 'Walk' }, { value: 'pram_walk', label: 'Pram walk' }, { value: 'stretching', label: 'Stretching' },
  { value: 'postnatal_class', label: 'Postnatal class' }, { value: 'yoga', label: 'Yoga' }, { value: 'other', label: 'Other' },
];
export const moveLabel = (k: MoveKind) => MOVE_KINDS.find(m => m.value === k)?.label ?? 'Movement';

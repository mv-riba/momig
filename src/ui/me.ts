import { createContext, useContext } from 'react';
import { useStore, mySettings, myProfile, live, currentUserId, defaultSettings } from '../lib/store';
import type { DayData } from '../lib/calc';
import type { Settings, EntryTable } from '../lib/types';

export interface Me { uid: string; email: string; name: string; settings: Settings; all: DayData }
/** Everything the screens need about her, from the store (re-computed only when the store changes). */
export function useMe(): Me | null {
  return useStore(s => {
    const uid = currentUserId(s); if (!uid) return null;
    const settings = mySettings(s) ?? defaultSettings(uid);
    return { uid, email: s.session!.email, name: myProfile(s)?.display_name || '', settings, all: { food: live('food', s), water: live('water', s), move: live('move', s) } };
  });
}

export type Tab = 'today' | 'week' | 'settings';
export type Route = { name: 'all' };
export interface Nav { tab: Tab; setTab(t: Tab): void; push(r: Route): void; pop(): void; openLog(kind: EntryTable, id?: string): void }
export const NavCtx = createContext<Nav>(null as any);
export const useNav = () => useContext(NavCtx);

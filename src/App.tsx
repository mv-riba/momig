import React, { useCallback, useState } from 'react';
import { useStore, isRemote, mySettings } from './lib/store';
import type { EntryTable } from './lib/types';
import { NavCtx, type Tab, type Route } from './ui/me';
import { ToastProvider, ConfirmProvider } from './ui/ui';
import { IToday, IWeek, ISettings, Logo } from './ui/icons';
import { AuthScreen } from './screens/Auth';
import { Onboarding } from './screens/Onboarding';
import { Today, AllEntries } from './screens/Today';
import { Week } from './screens/Week';
import { Settings } from './screens/Settings';
import { LogSheets } from './screens/Log';
import { Banners } from './screens/Banners';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'today', label: 'Today', icon: <IToday /> },
  { id: 'week', label: 'Week', icon: <IWeek /> },
  { id: 'settings', label: 'Settings', icon: <ISettings /> },
];
const tabFromHash = (): Tab => { const h = location.hash.replace('#tab-', ''); return (['today', 'week', 'settings'].includes(h) ? h : 'today') as Tab; };

function Shell() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [stack, setStack] = useState<Route[]>([]);
  const [log, setLog] = useState<{ kind: EntryTable; id?: string } | null>(null);
  const setTab = useCallback((t: Tab) => { setTabState(t); history.replaceState(history.state, '', '#tab-' + t); window.scrollTo(0, 0); }, []);
  const push = useCallback((r: Route) => { setStack(s => [...s, r]); window.scrollTo(0, 0); }, []);
  const pop = useCallback(() => setStack(s => s.slice(0, -1)), []);
  const openLog = useCallback((kind: EntryTable, id?: string) => setLog({ kind, id }), []);
  const top = stack[stack.length - 1];
  return (
    <NavCtx.Provider value={{ tab, setTab, push, pop, openLog }}>
      {top?.name === 'all' && <AllEntries onBack={pop} />}
      <main className="main" hidden={!!top}>
        <Banners />
        {tab === 'today' && <Today />}
        {tab === 'week' && <Week />}
        {tab === 'settings' && <Settings />}
      </main>
      {!top && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map(t => (
            <button key={t.id} className={`tab ${tab === t.id ? 'on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.icon}<span>{t.label}</span></button>
          ))}
        </nav>
      )}
      <LogSheets open={log} onClose={() => setLog(null)} />
    </NavCtx.Provider>
  );
}

function Loading({ text }: { text: string }) {
  return <div className="loading"><Logo size={64} /><p>{text}</p></div>;
}

export function App() {
  const loaded = useStore(s => s.loaded);
  const signedIn = useStore(s => !!s.session);
  const reauth = useStore(s => s.reauth);
  const settings = useStore(s => mySettings(s));
  const waiting = useStore(s => isRemote() && !s.initialPullDone);
  let screen: React.ReactNode;
  if (!loaded) screen = <Loading text="Opening Momig…" />;
  else if (!signedIn || reauth) screen = <AuthScreen notice={reauth} />;
  // a new phone: wait for her settings from the server before offering onboarding again
  else if (!settings?.onboarded_at && waiting) screen = <Loading text="Getting your log…" />;
  else if (!settings?.onboarded_at) screen = <Onboarding />;
  else screen = <Shell />;
  return <ToastProvider><ConfirmProvider>{screen}</ConfirmProvider></ToastProvider>;
}

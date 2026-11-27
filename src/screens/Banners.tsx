import React from 'react';
import { useStore, isRemote } from '../lib/store';
import { Note } from '../ui/ui';
import { useNow } from '../ui/ui';

/** Device and sync problems she should know about: a save that failed, changes the server refused, offline. */
export function Banners() {
  const saveError = useStore(s => s.saveError);
  const failed = useStore(s => s.failed.length);
  useNow(30000);
  const offline = isRemote() && typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <>
      {saveError && <Note kind="error">{saveError}</Note>}
      {failed > 0 && <Note kind="under">{failed === 1 ? 'One change' : `${failed} changes`} couldn’t sync yet. They’re kept on this phone and retried automatically.</Note>}
      {offline && <Note kind="soft">You’re offline. Everything you log is saved here and syncs when you’re back online.</Note>}
    </>
  );
}

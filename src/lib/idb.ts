// On-device persistence in IndexedDB (not localStorage: Bebig hit localStorage's ~5 MB cap after 9–12 months,
// and food logs grow faster). One object store per table plus a "meta" store for settings, the outbox and cursors.
// Writes are batched: the store hands over the rows that changed and this saves them in one transaction.
// A failed save is reported (the app shows a warning) rather than lost silently.

export interface Persist {
  load(): Promise<Record<string, Record<string, any>>>;
  save(changes: { store: string; key: string; value: any | undefined }[]): Promise<void>;
  clear(): Promise<void>;
}

export const STORES = ['food', 'water', 'move', 'meta'] as const;
const DB_NAME = 'momig';
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Momig is open in another tab with an older version. Close it and try again.'));
  });
}

export function indexedDbPersist(): Persist {
  let db: Promise<IDBDatabase> | null = null;
  const get = () => (db ??= open().catch(e => { db = null; throw e; }));
  const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Save aborted')); });
  return {
    async load() {
      const d = await get(); const out: Record<string, Record<string, any>> = {};
      const t = d.transaction(STORES as unknown as string[], 'readonly');
      await Promise.all(STORES.map(s => new Promise<void>((res, rej) => {
        out[s] = {};
        const c = t.objectStore(s).openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return res(); out[s][String(cur.key)] = cur.value; cur.continue(); };
        c.onerror = () => rej(c.error);
      })));
      return out;
    },
    async save(changes) {
      if (!changes.length) return;
      const d = await get();
      const t = d.transaction([...new Set(changes.map(c => c.store))], 'readwrite');
      for (const c of changes) { const os = t.objectStore(c.store); if (c.value === undefined) os.delete(c.key); else os.put(c.value, c.key); }
      await done(t);
    },
    async clear() {
      const d = await get(); const t = d.transaction(STORES as unknown as string[], 'readwrite');
      for (const s of STORES) t.objectStore(s).clear();
      await done(t);
    },
  };
}

/** For tests and for browsers without IndexedDB (the app then still works for the session, and says so). */
export function memoryPersist(initial: Record<string, Record<string, any>> = {}): Persist & { data: Record<string, Record<string, any>> } {
  const data: Record<string, Record<string, any>> = Object.fromEntries(STORES.map(s => [s, { ...(initial[s] || {}) }]));
  return {
    data,
    async load() { return structuredClone(data); },
    async save(changes) { for (const c of changes) { if (c.value === undefined) delete data[c.store][c.key]; else data[c.store][c.key] = structuredClone(c.value); } },
    async clear() { for (const s of STORES) data[s] = {}; },
  };
}

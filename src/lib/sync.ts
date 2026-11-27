// Sync orchestration. Local mode (no Supabase settings, e.g. the dev server): everything stays on this device.
// Cloud mode: supabase.ts sends the outbox and pulls changes from her other devices.
import { config } from './config';
import * as remote from './supabase';

export const syncMode = (): 'local' | 'remote' => (config.supabaseUrl && config.supabaseAnonKey ? 'remote' : 'local');

let started = false;
/** Called right after the device's copy has loaded (synchronously, so sign-in can't run before cloud auth is set up). */
export function startSync() {
  if (started) return; started = true;
  if (syncMode() === 'remote') remote.startRemoteSync();
}
export async function syncNow() { if (syncMode() === 'remote') await remote.syncNow(); }
export async function syncDiagnostics(): Promise<string> {
  if (syncMode() !== 'remote') return 'Local mode: no cloud sync in this build. Everything stays in this browser.';
  return remote.diagnostics();
}
export const lastSyncError = () => (syncMode() === 'remote' ? remote.lastSyncError() : null);

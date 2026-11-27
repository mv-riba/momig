// Runtime configuration, injected at build time (see build.mjs) from momig.config.json or environment variables:
//   MOMIG_SUPABASE_URL, MOMIG_SUPABASE_ANON_KEY — when unset (or in the dev server), the app runs on-device only ("local mode").
//   turnstileSiteKey — Cloudflare Turnstile on sign-in, sign-up and password reset (cloud only).
declare const __MOMIG_CONFIG__: { supabaseUrl: string; supabaseAnonKey: string; version: string; earlyAccessUntil?: string; turnstileSiteKey?: string };
export const config = typeof __MOMIG_CONFIG__ !== 'undefined' ? __MOMIG_CONFIG__ : { supabaseUrl: '', supabaseAnonKey: '', version: 'dev', earlyAccessUntil: '', turnstileSiteKey: '' };

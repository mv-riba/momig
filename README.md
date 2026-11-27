# Momig

Gentle self-care tracking for the months after birth: food, water and movement. She tracks only what she switches on; no suggested calorie targets, gentle notes only if she sets her own goal, and a Hide numbers switch. A sister app to [Bebig](https://github.com/mv-riba/bebig), published by MVR Studios. **Not medical advice**, and the app says so.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:5173 (local mode: accounts and entries stay in the browser)
npm test           # unit tests: day boundaries, totals, gentle notes, store/outbox, paged sync
npm run typecheck
npm run build      # production bundle in dist/ (cloud mode, from momig.config.json)
```

Database checks (needs a local Postgres; no Supabase required):

```bash
PGHOST=… PGPORT=… PGUSER=… supabase/tests/run.sh   # stub → migrations → 0001_init.test.sql; every line must end in "t"
```

## Architecture

Same as Bebig, with the lessons from Bebig's QA applied from day one.

| Layer | Choice | Notes |
|---|---|---|
| UI | React 19 + TypeScript, bundled by esbuild | Installable PWA, service worker for offline use. Back button closes sheets and screens (`src/ui/back.ts`). rem units for controls |
| Data on device | `src/lib/store.ts` + `src/lib/idb.ts` | **IndexedDB**, not localStorage. Instant saves, an outbox with one op per row, client UUIDs (no duplicates on retry), soft deletes, undo. A failed save is shown, never silent |
| Backend | Supabase (Postgres + Auth), dependency-free client (`src/lib/supabase.ts`) | RLS on every table: every row belongs to `created_by = auth.uid()`. **Paged pull** by `(server_updated_at, id)`; the cursor moves only after the last page. Polls every 15 s and on focus (no Realtime) |
| Calculations | `src/lib/calc.ts` | Pure and tested: her local day (IANA zone in settings), totals, gentle notes, week, small wins |
| Security | CSP injected at build time, no `innerHTML`/`eval`, frame check, device wiped on sign-out | Actions pinned to SHAs, Dependabot, `npm ci` |
| Email | Supabase custom SMTP (Resend), templates in `supabase/email-templates/` | Codes typed into the app (`{{ .Token }}`), never links |

## Going live

1. **Database** (Marija, in the SQL editor): run `supabase/migrations/0001_init.sql` once on the Momig project. It creates profiles, settings, food/water/move entries, app_settings and entitlements with RLS, size limits, immutable `created_by`/`created_at` and `delete_my_account()`.
2. **Auth** (Supabase → Authentication):
   - URL configuration: site URL `https://momig.app`, and add `https://momig.app` to the redirect allow list.
   - SMTP: Resend, sender `no-reply@mail.momig.app` (or the verified domain), name "Momig".
   - Templates: paste `supabase/email-templates/reset-password.html` and `confirm-signup.html` (subjects are in each file's first comment).
   - Confirm email: safe to switch on. The app asks for the code from the email (it uses `{{ .Token }}`, so keep that template).
   - Attack Protection: switch on Turnstile only together with a site key in `momig.config.json` (`turnstileSiteKey`), otherwise sign-up fails.
   - Passwords: same rules as Bebig (8+, upper and lower case, digit, symbol; leaked-password check).
3. **GitHub Pages**: Settings → Pages → Source "GitHub Actions", custom domain `momig.app`, Enforce HTTPS. Add a "Protect main" ruleset as in Bebig (PRs required, the "build" check must pass).
4. **DNS at Namecheap**: `A` records for the apex to GitHub Pages (185.199.108.153, .109.153, .110.153, .111.153) and a `CNAME` for `www` → `mv-riba.github.io`.
5. Later: the Bubblewrap TWA (package `app.momig`) with `assetlinks.json`, the Play listing, and the DPIA.

`momig.config.json` holds the Supabase URL and the public (publishable) key; env vars `MOMIG_SUPABASE_URL` / `MOMIG_SUPABASE_ANON_KEY` override it. Every push to `main` tests, type-checks, builds and deploys.

## Not in the MVP yet

AI advisor, Bebig walk sync, the Bebig + Momig bundle, Momig Plus features and an in-app export (the privacy policy says to email for a copy until then).

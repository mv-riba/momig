-- Momig initial schema (PostgreSQL / Supabase). Run once, in the SQL editor, on a new project.
--
-- Principles (carried over from Bebig, including the hardening Bebig added in 0005–0007):
--  * One person's own data. Every row belongs to the account that created it (created_by = auth.uid()),
--    and row-level security lets only that account read or change it. No sharing in the MVP.
--  * Client-generated UUID primary keys, so an entry retried after being offline is never saved twice.
--  * Times are timestamptz (UTC); the settings row holds her IANA time zone for "today" and the week.
--  * Soft deletes (deleted_at) so a delete on one phone reaches her other phones.
--  * server_updated_at is set by the server on every write; the app pulls by (server_updated_at, id), in pages.
--  * created_by / created_at can't be changed through the API. Size limits on every free-text field.
--  * Entitlements and app_settings as in Bebig (one plan per account), ready for Momig Plus.
--  * Deleting the account deletes everything (foreign keys cascade from auth.users).

create extension if not exists "pgcrypto";

-- ---------- helpers ----------
create or replace function public.touch_server_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.server_updated_at := now(); return new; end $$;

-- The API roles can't change who created a row or when. Internal operations (security definer functions,
-- the dashboard) run as the table owner and are unaffected.
create or replace function public.protect_server_columns() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

-- ---------- profiles (public part of auth.users) ----------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (length(email) <= 254),
  display_name text not null default '' check (length(display_name) <= 80),
  consent_at timestamptz,          -- sign-up consent: 18+, Terms, storing the health-related entries she logs
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

-- ---------- settings (one row per account) ----------
create table public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  track_food boolean not null default false,
  track_water boolean not null default false,
  track_move boolean not null default false,
  kcal_goal integer check (kcal_goal between 500 and 6000),   -- her own number; the app never suggests one
  gentle_notes boolean not null default true,
  hide_numbers boolean not null default false,               -- no calories anywhere, notes off
  water_goal integer not null default 8 check (water_goal between 1 and 30),
  glass_ml integer not null default 250 check (glass_ml between 50 and 1000),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now()
);

-- A new account gets a profile and a settings row (all trackers off until she chooses).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name, consent_at)
  values (new.id, lower(new.email),
          left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), ''), 80),
          case when (new.raw_user_meta_data->>'consent') = 'true' then now() end);
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- profiles.email follows the verified auth email
create or replace function public.handle_user_email_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = lower(new.email), updated_at = now() where user_id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (new.email is distinct from old.email and new.email is not null) execute function public.handle_user_email_change();

create or replace function public.protect_profile() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.user_id := old.user_id;
    new.email := old.email;
    new.created_at := old.created_at;
    -- consent time is recorded by the server, never taken from the device
    if new.consent_at is not null and old.consent_at is null then new.consent_at := now();
    elsif new.consent_at is not null then new.consent_at := old.consent_at; end if;
  end if;
  return new;
end $$;

create or replace function public.protect_settings() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  -- raises "time zone ... not recognized" for anything that isn't a real zone (a bad one would break day counts)
  perform now() at time zone new.timezone;
  return new;
end $$;

-- ---------- entries ----------
create table public.food_entries (
  food_id uuid primary key,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  at timestamptz not null,
  name text not null check (length(trim(name)) between 1 and 120),
  kcal integer check (kcal between 0 and 5000),               -- empty when she logs without numbers
  source text not null default 'manual' check (source in ('manual', 'recent', 'pick')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table public.water_entries (
  water_id uuid primary key,                                  -- one row per glass
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  at timestamptz not null,
  ml integer not null check (ml between 50 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

create table public.move_entries (
  move_id uuid primary key,
  created_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  at timestamptz not null,
  kind text not null check (kind in ('walk', 'pram_walk', 'stretching', 'postnatal_class', 'yoga', 'other')),
  minutes integer not null check (minutes between 1 and 600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now()
);

-- Entry times must be plausible, and a day can only hold so many entries (stops one account filling the
-- free plan's database). Real days are far below these limits.
create or replace function public.check_entry() returns trigger language plpgsql set search_path = public as $$
declare n integer; lim integer;
begin
  if new.at < timestamptz '2020-01-01' or new.at > now() + interval '1 day' then
    raise exception using errcode = 'P0001', message = 'entry_time', detail = 'The time of an entry can’t be in the future.';
  end if;
  if tg_op = 'INSERT' then
    lim := case tg_table_name when 'food_entries' then 100 when 'water_entries' then 60 else 50 end;
    execute format('select count(*) from public.%I where created_by = $1 and at >= $2 - interval ''1 day'' and at < $2 + interval ''1 day''', tg_table_name)
      into n using new.created_by, new.at;
    if n >= lim * 2 then
      raise exception using errcode = 'P0001', message = 'entry_limit', detail = format('A day can hold up to %s entries of this kind.', lim);
    end if;
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','settings','food_entries','water_entries','move_entries'] loop
    execute format('create trigger %1$s_touch before insert or update on public.%1$s for each row execute function public.touch_server_updated_at()', t);
  end loop;
  foreach t in array array['food_entries','water_entries','move_entries'] loop
    execute format('create trigger %1$s_protect before update on public.%1$s for each row execute function public.protect_server_columns()', t);
    execute format('create trigger %1$s_check before insert or update of at on public.%1$s for each row execute function public.check_entry()', t);
    execute format('create index %1$s_sync on public.%1$s (created_by, server_updated_at, %2$s)', t, replace(t, '_entries', '') || '_id');
    execute format('create index %1$s_time on public.%1$s (created_by, at)', t);
  end loop;
end $$;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile();
create trigger settings_protect before insert or update on public.settings for each row execute function public.protect_settings();

-- ---------- Momig Plus: settings and entitlements (as in Bebig; one plan per account) ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('early_access_until', '"2026-12-31T22:00:00Z"'), -- 1 Jan 2027 00:00 Helsinki: change in the SQL editor
  ('plus_limits', '{"trial_days": 14, "trial_min_logged_days": 10}');

create table public.entitlements (
  entitlement_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'plus' check (plan in ('plus', 'bundle')),  -- bundle = Bebig + Momig (later)
  source text not null check (source in ('trial', 'promo', 'play', 'stripe', 'manual')),
  product_id text,
  status text not null default 'active' check (status in ('active', 'grace', 'cancelled', 'expired', 'refunded')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  purchase_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index entitlements_owner on public.entitlements (owner_id);

create or replace function public.setting(k text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from app_settings where key = k $$;
create or replace function public.limit_value(k text) returns integer language sql stable security definer set search_path = public as $$
  select (value->>k)::integer from app_settings where key = 'plus_limits' $$;

create or replace function public.has_plus(u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((setting('early_access_until') #>> '{}')::timestamptz > now(), false)
      or exists (select 1 from entitlements e where e.owner_id = u and e.status in ('active', 'grace', 'cancelled')
                 and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())) $$;

-- distinct local days with anything logged (soft-deleted entries don't count)
create or replace function public.logged_days(u uuid) returns integer language sql stable security definer set search_path = public as $$
  with tz as (select coalesce((select timezone from settings where user_id = u), 'UTC') as z),
  t as (
    select at from food_entries where created_by = u and deleted_at is null
    union all select at from water_entries where created_by = u and deleted_at is null
    union all select at from move_entries where created_by = u and deleted_at is null
  )
  select count(distinct (t.at at time zone (select z from tz))::date)::integer from t $$;

create or replace function public.plus_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  ea timestamptz := (setting('early_access_until') #>> '{}')::timestamptz;
  cur record; trial_used boolean; days integer;
begin
  if u is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select plan, source, product_id, status, expires_at into cur from entitlements e
    where e.owner_id = u and e.status in ('active', 'grace', 'cancelled') and e.starts_at <= now() and (e.expires_at is null or e.expires_at > now())
    order by (e.expires_at is null) desc, e.expires_at desc limit 1;
  trial_used := exists (select 1 from entitlements where owner_id = u and source = 'trial');
  days := logged_days(u);
  return jsonb_build_object(
    'plus', has_plus(u), 'early_access_until', ea, 'early_access', coalesce(ea > now(), false),
    'plan', cur.plan, 'source', cur.source, 'product_id', cur.product_id, 'status', cur.status, 'expires_at', cur.expires_at,
    'trial_used', trial_used, 'logged_days', days,
    'trial_eligible', not trial_used and cur.source is null and days >= limit_value('trial_min_logged_days'),
    'checked_at', now());
end $$;

create or replace function public.start_plus_trial() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('trial:' || u::text)); -- two phones tapping at once get one trial
  if exists (select 1 from entitlements where owner_id = u and source = 'trial') then raise exception 'The free trial has already been used'; end if;
  if logged_days(u) < limit_value('trial_min_logged_days') then raise exception 'The free trial starts after % days of logging', limit_value('trial_min_logged_days'); end if;
  insert into entitlements (owner_id, source, status, starts_at, expires_at)
  values (u, 'trial', 'active', now(), now() + make_interval(days => limit_value('trial_days')));
  return plus_status();
end $$;

-- ---------- account deletion (GDPR): everything goes with the auth user ----------
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  delete from auth.users where id = v_uid; -- profiles, settings, entries and entitlements cascade
end $$;

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.food_entries enable row level security;
alter table public.water_entries enable row level security;
alter table public.move_entries enable row level security;
alter table public.app_settings enable row level security;
alter table public.entitlements enable row level security; -- no policies: read through plus_status(), written by server code only

create policy profiles_select on public.profiles for select using (user_id = auth.uid());
create policy profiles_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy settings_select on public.settings for select using (user_id = auth.uid());
create policy settings_insert on public.settings for insert with check (user_id = auth.uid());
create policy settings_update on public.settings for update using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ declare t text; begin
  foreach t in array array['food_entries','water_entries','move_entries'] loop
    execute format('create policy %1$s_select on public.%1$s for select using (created_by = auth.uid())', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (created_by = auth.uid())', t);
    execute format('create policy %1$s_update on public.%1$s for update using (created_by = auth.uid()) with check (created_by = auth.uid())', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (created_by = auth.uid())', t);
  end loop;
end $$;

create policy app_settings_read on public.app_settings for select using (true); -- public, non-sensitive switches

-- ---------- privileges ----------
-- Newer Supabase projects don't grant new tables to the API roles automatically, and their defaults include
-- TRUNCATE (which bypasses RLS), TRIGGER and REFERENCES. Grant exactly what the app uses.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.settings, public.food_entries, public.water_entries, public.move_entries,
  public.app_settings, public.entitlements from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.settings to authenticated;
grant select, insert, update, delete on public.food_entries, public.water_entries, public.move_entries to authenticated;
grant select on public.app_settings to anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- Supabase grants new functions to anon (and public) by default: only signed-in users may call the API ones,
-- and the helpers and trigger functions aren't callable through the API at all (triggers still fire).
revoke all on function public.touch_server_updated_at(), public.protect_server_columns(), public.handle_new_user(),
  public.handle_user_email_change(), public.protect_profile(), public.protect_settings(), public.check_entry(),
  public.setting(text), public.limit_value(text), public.has_plus(uuid), public.logged_days(uuid),
  public.plus_status(), public.start_plus_trial(), public.delete_my_account() from public, anon, authenticated;
grant execute on function public.plus_status(), public.start_plus_trial(), public.delete_my_account() to authenticated;

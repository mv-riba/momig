\set ON_ERROR_STOP 1
-- Local check of the security rules: on a fresh Postgres, run supabase-stub.sql, then ../migrations/0001_init.sql,
-- then this file. Every line printed should end in "t" (run.sh fails if one says "f").
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'A@x.fi', '{"display_name":"Anna","consent":"true"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@x.fi', jsonb_build_object('display_name', repeat('n', 500)));
create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claims', json_build_object('sub', u)::text, false); end $$;
create function pg_temp.blocked(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;

select 'sign-up makes a profile with consent, lower-case email' as t, (email = 'a@x.fi' and display_name = 'Anna' and consent_at is not null) as ok from profiles where user_id = '00000000-0000-0000-0000-00000000000a';
select 'no consent flag, no consent time; long name trimmed' as t, (consent_at is null and length(display_name) = 80) as ok from profiles where user_id = '00000000-0000-0000-0000-00000000000b';
select 'sign-up makes settings with every tracker off' as t, not (track_food or track_water or track_move) and onboarded_at is null as ok from settings where user_id = '00000000-0000-0000-0000-00000000000a';

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- settings
insert into settings (user_id, track_food, timezone, onboarded_at) values ('00000000-0000-0000-0000-00000000000a', true, 'Europe/Helsinki', now())
  on conflict (user_id) do update set track_food = excluded.track_food, timezone = excluded.timezone, onboarded_at = excluded.onboarded_at;
select 'upsert own settings' as t, track_food and timezone = 'Europe/Helsinki' as ok from settings;
select 'sees only own settings' as t, count(*) = 1 as ok from settings;
select 'invalid time zone refused' as t, pg_temp.blocked($q$update settings set timezone = 'Not/AZone'$q$) as ok;
select 'calorie goal must be sensible' as t, pg_temp.blocked($q$update settings set kcal_goal = 50$q$) as ok;
select 'can’t write someone else’s settings' as t, pg_temp.blocked($q$insert into settings (user_id) values ('00000000-0000-0000-0000-00000000000b')$q$) as ok;
update settings set user_id = '00000000-0000-0000-0000-00000000000b';
select 'user_id of settings can’t be changed' as t, user_id = '00000000-0000-0000-0000-00000000000a' as ok from settings;

-- profile
update profiles set display_name = 'Anna R', email = 'evil@x.fi', consent_at = '2000-01-01';
select 'profile: name editable, email and consent time fixed' as t, (display_name = 'Anna R' and email = 'a@x.fi' and consent_at > '2020-01-01') as ok from profiles;
select 'sees only own profile' as t, count(*) = 1 as ok from profiles;
select 'name size limit' as t, pg_temp.blocked($q$update profiles set display_name = repeat('z', 81)$q$) as ok;

-- entries
insert into food_entries (food_id, at, name, kcal) values ('11111111-0000-0000-0000-000000000001', now() - interval '1 hour', 'Porridge', 250);
insert into water_entries (water_id, at, ml) values ('22222222-0000-0000-0000-000000000001', now(), 250);
insert into move_entries (move_id, at, kind, minutes) values ('33333333-0000-0000-0000-000000000001', now(), 'pram_walk', 25);
select 'created_by defaults to me' as t, created_by = '00000000-0000-0000-0000-00000000000a' as ok from food_entries;
select 'food without calories is fine' as t, not pg_temp.blocked($q$insert into food_entries (food_id, at, name) values (gen_random_uuid(), now(), 'Toast')$q$) as ok;
select 'can’t log as someone else' as t, pg_temp.blocked($q$insert into food_entries (food_id, created_by, at, name) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000b', now(), 'x')$q$) as ok;
select 'future entry refused' as t, pg_temp.blocked($q$insert into water_entries (water_id, at, ml) values (gen_random_uuid(), now() + interval '3 days', 250)$q$) as ok;
select 'huge food name refused' as t, pg_temp.blocked($q$insert into food_entries (food_id, at, name) values (gen_random_uuid(), now(), repeat('x', 121))$q$) as ok;
select 'unknown movement kind refused' as t, pg_temp.blocked($q$insert into move_entries (move_id, at, kind, minutes) values (gen_random_uuid(), now(), 'marathon', 10)$q$) as ok;
update food_entries set created_by = '00000000-0000-0000-0000-00000000000b', created_at = '2000-01-01' where food_id = '11111111-0000-0000-0000-000000000001';
select 'created_by / created_at can’t be changed' as t, (created_by = '00000000-0000-0000-0000-00000000000a' and created_at > '2020-01-01') as ok from food_entries where food_id = '11111111-0000-0000-0000-000000000001';
select 'soft delete works' as t, not pg_temp.blocked($q$update water_entries set deleted_at = now()$q$) as ok;
select 'daily limit' as t, pg_temp.blocked($q$insert into water_entries (water_id, at, ml) select gen_random_uuid(), now(), 250 from generate_series(1, 130)$q$) as ok;
select 'server_updated_at set by the server' as t, server_updated_at > now() - interval '1 minute' as ok from move_entries;

-- another account sees none of it
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select 'B sees none of A’s entries' as t, (select count(*) from food_entries) + (select count(*) from water_entries) + (select count(*) from move_entries) = 0 as ok;
update food_entries set name = 'hacked';
delete from move_entries;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'B could not change or delete them' as t, (select name from food_entries where food_id = '11111111-0000-0000-0000-000000000001') = 'Porridge' and (select count(*) from move_entries) = 1 as ok;

-- entitlements
select 'entitlements not readable directly' as t, pg_temp.blocked('select * from entitlements') as ok;
select 'entitlements not writable directly' as t, pg_temp.blocked($q$insert into entitlements (owner_id, source) values ('00000000-0000-0000-0000-00000000000a', 'manual')$q$) as ok;
select 'plus_status works (early access)' as t, (plus_status()->>'plus')::boolean and (plus_status()->>'logged_days')::int = 1 as ok;
select 'trial needs 10 logged days' as t, pg_temp.blocked('select start_plus_trial()') as ok;
select 'helpers not callable' as t, pg_temp.blocked($q$select has_plus('00000000-0000-0000-0000-00000000000a')$q$) as ok;
select 'app_settings read-only' as t, pg_temp.blocked($q$update app_settings set value = '"2099-01-01"' where key = 'early_access_until'$q$) or (select count(*) from app_settings where value = '"2099-01-01"') = 0 as ok;
reset role;
update app_settings set value = to_jsonb(now() - interval '1 day') where key = 'early_access_until';
insert into food_entries (food_id, created_by, at, name) select gen_random_uuid(), '00000000-0000-0000-0000-00000000000a', now() - make_interval(days => d), 'x' from generate_series(1, 10) d;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select 'no Plus after early access' as t, not (plus_status()->>'plus')::boolean as ok;
select 'trial starts after 10 days' as t, (start_plus_trial()->>'plus')::boolean as ok;
select 'only one trial' as t, pg_temp.blocked('select start_plus_trial()') as ok;

-- account deletion
select delete_my_account();
reset role;
select 'deleting the account removes everything' as t,
  (select count(*) from auth.users where id = '00000000-0000-0000-0000-00000000000a') + (select count(*) from profiles where user_id = '00000000-0000-0000-0000-00000000000a')
  + (select count(*) from settings where user_id = '00000000-0000-0000-0000-00000000000a') + (select count(*) from food_entries) + (select count(*) from water_entries)
  + (select count(*) from move_entries) + (select count(*) from entitlements) = 0 as ok;
set role anon;
select 'anon: no table access' as t, pg_temp.blocked('select * from food_entries') and pg_temp.blocked('select * from settings') as ok;
select 'anon: can’t delete accounts' as t, pg_temp.blocked('select delete_my_account()') as ok;
reset role;

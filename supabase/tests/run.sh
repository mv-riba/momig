#!/bin/sh
# Runs the database security checks on a throwaway local Postgres database.
# Usage: PGHOST=… PGPORT=… PGUSER=… supabase/tests/run.sh   (needs createdb/psql; the database "momig_test" is recreated)
set -e
cd "$(dirname "$0")"
dropdb --if-exists momig_test >/dev/null 2>&1 || true
createdb momig_test
psql -q -X -v ON_ERROR_STOP=1 -d momig_test -f supabase-stub.sql
for m in ../migrations/*.sql; do psql -q -X -v ON_ERROR_STOP=1 -d momig_test -f "$m"; done
out=$(psql -q -X -A -t -F ' | ' -d momig_test -f 0001_init.test.sql)
echo "$out"
if echo "$out" | grep -q '| f$'; then echo "FAILED"; exit 1; fi
echo "All database checks passed."

#!/usr/bin/env bash
# Builds a throwaway test database from the SQL files and runs the rule tests.
# Needs a local PostgreSQL with pgTAP and pg_prove. NEVER point it at the real Supabase project.
#   PGHOST/PGPORT/PGUSER select the server (default: local). The database is dropped and re-created.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${TEST_DB:-saic_rules_test}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
case "${PGHOST:-localhost}" in *supabase.co*|*supabase.com*) echo "Refusing to run against Supabase"; exit 1;; esac

psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
APP="supabase/schema.sql supabase/treasury.sql supabase/pdg.sql supabase/reception.sql supabase/dg_saic.sql supabase/dg_whp.sql"
echo "Loading the SQL files in the README order, then a second time (they say they are safe to run again)"
for f in supabase/tests/supabase_shim.sql $APP $APP supabase/tests/helpers.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" > /dev/null
done
psql -v ON_ERROR_STOP=1 -qtA -d "$DB" -c "select 'Imported cash lines: ' || count(*) from public.cash_transactions where source = 'import'"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "create extension if not exists pgtap"
pg_prove -d "$DB" --ext .sql supabase/tests/rules/

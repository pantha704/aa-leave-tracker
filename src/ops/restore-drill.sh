#!/usr/bin/env bash
# Restore drill: dump, drop public schema objects, restore, verify employees table.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
DUMP="${1:-/tmp/aa-leave-restore-drill.sql}"
pg_dump "$DATABASE_URL" --schema=public --no-owner > "$DUMP"
# Newer pg_dump emits GUCs (e.g. transaction_timeout) that older restore servers reject.
sed -i '/^SET transaction_timeout/d' "$DUMP"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DUMP"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.employees') IS NOT NULL AS employees_restored;"
echo "restore-drill ok dump=$DUMP"

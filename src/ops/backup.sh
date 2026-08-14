#!/usr/bin/env bash
# Dump Postgres from DATABASE_URL. Usage: src/ops/backup.sh [outfile.sql]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
out="${1:-aa-leave-$(date -u +%Y%m%dT%H%M%SZ).sql}"
pg_dump --no-owner --no-acl --dbname="$DATABASE_URL" --file="$out"
echo "Wrote $out"

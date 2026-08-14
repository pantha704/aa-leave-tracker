#!/usr/bin/env bash
# Local plaintext pg_dump from DATABASE_URL. Not an offsite/encrypted backup.
# Usage: src/ops/backup.sh [outfile.sql]
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL is required}"

root="$(cd "$(dirname "$0")/../.." && pwd)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [ "${1:-}" = "" ]; then
  mkdir -p "$root/backups"
  out="$root/backups/aa-leave-${stamp}.sql"
else
  out="$1"
fi

if [ -e "$out" ]; then
  echo "Refusing to overwrite $out" >&2
  exit 1
fi

pg_dump --no-owner --no-acl --dbname="$DATABASE_URL" --file="$out"
chmod 600 "$out"
echo "Wrote $out"

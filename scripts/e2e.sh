#!/usr/bin/env bash
# Run Playwright e2e tests. In CI this is a no-op unless PLAYWRIGHT=1.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${CI:-}" = "true" ] && [ "${PLAYWRIGHT:-}" != "1" ]; then
  echo "Skipping Playwright (set PLAYWRIGHT=1 to enable in CI)."
  exit 0
fi
exec bunx playwright test "$@"

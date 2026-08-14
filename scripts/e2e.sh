#!/usr/bin/env bash
# Playwright e2e. In CI without PLAYWRIGHT=1, run @smoke only (login + redirects + CSP).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${CI:-}" = "true" ] && [ "${PLAYWRIGHT:-}" != "1" ]; then
  exec bunx playwright test --grep @smoke "$@"
fi
exec bunx playwright test "$@"

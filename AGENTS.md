<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Absolute Addiction leave-policy source of truth

Before changing leave, accrual, carryover, holiday, approval, email, employee-status, LWOP, make-up-time, or parental-leave behavior, read `docs/PTO_POLICY_2026.md`.

Rules in that file are the production policy baseline effective 2026-01-01. Do not fall back to older assumptions that policy details are unknown/configurable when the 2026 policy now specifies them.

Important invariants:

- Keep accrued PTO, Sick Leave, and LWOP separate.
- Annual accrued PTO must not exceed 17 days / 136 hours because of monthly rounding.
- Company holidays do not consume PTO.
- Normal PTO requires 14 calendar days of notice unless an explicit emergency/medical exception applies.
- Manager approval, not generic admin-only approval, is the normal PTO approval path.
- Never overwrite calculated balances; use immutable ledger transactions and reversals.
- When policy wording is genuinely ambiguous, preserve the ambiguity in code/configuration or documentation rather than inventing a hidden rule.

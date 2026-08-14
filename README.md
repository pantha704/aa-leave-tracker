# Absolute Addiction Leave

Internal leave tracker for Absolute Addiction.

## Prerequisites

- [Bun](https://bun.sh) 1.3+ (`curl -fsSL https://bun.sh/install | bash`)
- PostgreSQL 16 (optional for the first boot; required for a live DB ping)

## Setup

```bash
cp .env.example .env
bun install
```

Edit `.env` if your Postgres URL differs from the example.

## Run locally

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000). Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health).

`GET /api/health` always returns `{ "ok": true }`. When `DATABASE_URL` is set it also reports `db` as `"up"` or `"down"` after a Postgres ping. When `DATABASE_URL` is unset, `db` is `"skipped"`.

## Local Postgres

```bash
docker run --name aa-leave-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=aa_leave_tracker \
  -p 5432:5432 \
  -d postgres:16
```

## Scripts

| Script | Purpose |
| --- | --- |
| `bun dev` | Next.js dev server |
| `bun run build` | Production build |
| `bun start` | Serve the production build |
| `bun run typecheck` | `next typegen && tsc --noEmit` |
| `bun run test` | Vitest |
| `bun run test:e2e` | Playwright. CI runs `@smoke` only; set `PLAYWRIGHT=1` for the full suite |
| `bun run db:generate` | Drizzle Kit generate |
| `bun run db:migrate` | Apply Drizzle migrations |
| `bun run db:seed` | Seed DEMO org (requires `SEED_TIMEZONE` and `SEED_ADMIN_PASSWORD`) |
| `bun run job:accrual` | Monthly vacation accrual (no-op unless the period is `open`) |

## Auth

Email + password via Better Auth. There is no public registration endpoint.

- `BETTER_AUTH_SECRET` is required at runtime (not for `GET /api/health`).
- Seed creates the admin employee and a credential. `SEED_ADMIN_PASSWORD` is required.
- First admin login is forced through `/login/change-password`.
- After login: admin → `/admin`, employee → `/me`.
- Employees who `GET /admin` (including `/admin/holidays` and `/admin/leave-types`) receive **403** (not 404) from both the proxy and `authorizeAdmin` / `requireAdmin`.
- Holidays start empty; import CSV (`date`, `name`, optional `region`). Unique per `(org, date, region)`. No holiday seed.
- Sheet cutover at `/admin/import`: map columns (headers are not assumed), dry-run, commit a reversible `import_batches` row. Opening remaining is `adjustment` only (`reason = import: opening remaining`), never `grant_lump`. Posted minutes are **sheet remaining − current app remaining**. Historical rows land `approved` (or mapped `rejected`/`cancelled`) with `immutable_at`. Import opening remaining **or** same-year used days, not both. Dry-run hard-fails a Sick first-year double-grant, occupancy overlap, and returns an error CSV plus sheet-vs-app remaining diff.
- Leave types are admin CRUD (`code`, `name`, `consumes_balance`, `legal_unit` hours|days, min increment, color). Types with entries or related FK rows cannot be deleted.
- Admin roster at `/admin/employees` (search, remaining vacation hours, last entry). Employee file has balances, ledger, entries, policy assign, and required-reason hour adjustments. Approve/reject/cancel go through `decide.ts`. Every admin page shows a pending-request badge.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- In production set `BETTER_AUTH_URL` to an `https://` origin.
- Login is throttled in-memory per process (10 attempts / 15 minutes) on `/login` and `POST /api/auth/sign-in/*`. Successful sign-in resets that IP. This is **not** shared across Node instances or serverless isolates.
- Client `X-Forwarded-For` / `X-Real-IP` are ignored unless `TRUST_PROXY=1` (then the **rightmost** XFF hop is used). Do not enable `TRUST_PROXY` unless a reverse proxy overwrites those headers.
- Document responses set a per-request `Content-Security-Policy` in `src/proxy.ts` (nonce + `strict-dynamic`; production `script-src` has no `'unsafe-inline'` or `'unsafe-eval'`). `style-src` still allows `'unsafe-inline'` because React/Tailwind emit style attributes and next/font injects CSS. Complementary headers (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`) are in `next.config.ts`.

## Backup

`src/ops/backup.sh` is a **local plaintext** `pg_dump` of `DATABASE_URL` (`umask 077`). It is not offsite, IAM-managed, or encrypted. Default output is `backups/aa-leave-<UTC>.sql` (gitignored). Pass an explicit path to write elsewhere. Refuses to overwrite. `pg_dump` must be on `PATH`. Optional encrypt: `gpg -c backups/aa-leave-….sql`.

```bash
./src/ops/backup.sh
./src/ops/backup.sh /path/to/aa-leave.sql
```

## End-to-end tests

Playwright specs live in `tests/e2e/` (employee log, admin approve, import remaining-hours diff). CI installs Chromium and runs `@smoke` (login, unauth redirects, CSP header). Set `PLAYWRIGHT=1` for the full suite.

```bash
bunx playwright install chromium
bun run test:e2e
# or
bunx playwright test
```

Authenticated flows need a running app plus creds with `must_change_password = false` (or set `E2E_NEW_PASSWORD` so `signIn` can complete `/login/change-password`):

- `E2E_EMPLOYEE_EMAIL` / `E2E_EMPLOYEE_PASSWORD` for `/me` log and the approve flow
- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` for `/admin/import` and approve
- `E2E_IMPORT_EMAIL` (defaults to the employee or admin email) and optional `E2E_IMPORT_LEAVE_TYPE` (default `vacation_unpaid`)

Without those env vars the `@smoke` specs still run. Override the server with `PLAYWRIGHT_BASE_URL` if it is already running.

Do not commit `.env`.

## Year-end close (ops)

Close the year from `/admin/year-end` **before the first January working day**. Close is an admin action (not an implicit 1 January cron). It freezes new usage dated in year Y, writes **carryover only** (capped by `carryover_max_minutes`; forfeit stays off unless the policy flag is on), grants the Sick 3-day allotment when Y+1 opens, and does **not** write a 17-day Vacation/Unpaid lump.

Seed opens the current year and inserts Y+1 as `future` (so December can request January). After assigning policies, run **first-year open on the same year** to grant Sick. First-year open refuses if another year is already `open`.

Monthly accrual (`bun run job:accrual` / `bun src/jobs/accrual.ts`) is a no-op until that period is `open`. Reopen reverses close-created carryover and sick grants (`reversed_at`); it does not delete rows.

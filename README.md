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
| `bun run test:e2e` | Playwright e2e (`tests/e2e/`). In CI this skips unless `PLAYWRIGHT=1` |
| `bun run db:generate` | Drizzle Kit generate |
| `bun run db:migrate` | Apply Drizzle migrations |
| `bun run db:seed` | Seed DEMO org (requires `SEED_TIMEZONE` and `SEED_ADMIN_PASSWORD`) |

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
- Login is throttled in-memory per client IP (10 attempts / 15 minutes) on `/login` and `/api/auth/sign-in/*`.
- Responses set a `Content-Security-Policy` (see `next.config.ts`).

## Backup

`src/ops/backup.sh` runs `pg_dump` against `DATABASE_URL` (requires `pg_dump` on `PATH`).

```bash
./src/ops/backup.sh
./src/ops/backup.sh /path/to/aa-leave.sql
```

## End-to-end tests

Playwright specs live in `tests/e2e/` (employee log flow + import dry-run / remaining-hours diff). CI skips them unless `PLAYWRIGHT=1`.

```bash
bunx playwright install chromium
bun run test:e2e
# or
bunx playwright test
```

Authenticated flows need a running app plus:

- `E2E_EMPLOYEE_EMAIL` / `E2E_EMPLOYEE_PASSWORD` for `/me` log
- `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` for `/admin/import` dry-run

Without those env vars the specs still smoke `/login` and the unauthenticated redirect. Override the server with `PLAYWRIGHT_BASE_URL` if it is already running.

Do not commit `.env`.

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
- Leave types are admin CRUD (`code`, `name`, `consumes_balance`, `legal_unit` hours|days, min increment, color). Types with entries or related FK rows cannot be deleted.
- Admin roster at `/admin/employees` (search, remaining vacation hours, last entry). Employee file has balances, ledger, entries, policy assign, required-reason hour adjustments, and terminate. Approve/reject/cancel go through `decide.ts`. Every admin page shows a pending-request badge.
- Terminate (`POST /api/admin/employees/:id/terminate` or the employee-file button) sets `end_date` and `active=false`, cancels pending/draft entries wholly after `end_date` (mixed spans are trimmed), reverses approved usage with `effective_on > end_date`, and sets `immutable_at` on remaining entries. `endDate` cannot be after org-local today. Grant/accrual jobs skip any `effective_on` after `end_date` (`shouldSkipGrantOrAccrual`); last-day grants still post. A second call re-exports the two-column CSV.
- Admin CSV export at `/admin/export` (`GET /api/admin/export/:kind.csv` for `balances`, `entries`, `ledger`, `termination`). Each download is audited. Termination CSV always has `ledger_remaining` and `pro_rata_earned_to_end_date`. Lump-sum working days skip org-global holidays (`region` null) only. Terminate returns the same two-column CSV plus a download path.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- In production set `BETTER_AUTH_URL` to an `https://` origin.

Do not commit `.env`.

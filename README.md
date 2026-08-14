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
| `bun run job:accrual` | Monthly vacation accrual (no-op unless the period is `open`) |

## Auth

Email + password via Better Auth. There is no public registration endpoint.

- `BETTER_AUTH_SECRET` is required at runtime (not for `GET /api/health`).
- Seed creates the admin employee and a credential. `SEED_ADMIN_PASSWORD` is required.
- First admin login is forced through `/login/change-password`.
- After login: admin → `/admin`, employee → `/me`.
- Employees who `GET /admin` receive **403** (not 404) from both the proxy and `authorizeAdmin` / `requireAdmin`.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- In production set `BETTER_AUTH_URL` to an `https://` origin.

Do not commit `.env`.

## Year-end close (ops)

Close the year from `/admin/year-end` **before the first January working day**. Close is an admin action (not an implicit 1 January cron). It freezes new usage dated in year Y, writes **carryover only** (capped by `carryover_max_minutes`; forfeit stays off unless the policy flag is on), grants the Sick 3-day allotment when Y+1 opens, and does **not** write a 17-day Vacation/Unpaid lump.

Monthly accrual (`bun run job:accrual` / `bun src/jobs/accrual.ts`) is a no-op until that period is `open`. Reopen reverses close-created carryover and sick grants (`reversed_at`); it does not delete rows.

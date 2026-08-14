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

Schema and auth land in later PRs. Do not commit `.env`.

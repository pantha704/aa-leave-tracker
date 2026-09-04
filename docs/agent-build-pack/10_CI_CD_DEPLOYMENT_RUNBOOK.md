# CI/CD and Deployment Runbook

## Environments

Use fully separated:

- local/dev
- staging
- production

Each has distinct:

- database
- Better Auth secret/base URL
- email credentials
- cron secret
- app URL
- seed/test credentials

Preview deployments must never point to production DB.

## Git workflow

- protected `main`
- feature branches
- PR required
- CI required before merge
- no force-push to protected release branch
- production deploy from reviewed merge/tag only

Recommended GitHub protections:

- required status checks
- branch up-to-date requirement if practical
- at least one review for production changes if team permits
- prevent deletion/force push
- secret scanning / Dependabot or equivalent

## CI jobs

Split for useful diagnostics:

1. `static`
   - install
   - lint
   - typecheck
   - production build
2. `unit`
   - Vitest
3. `db-integration`
   - PostgreSQL service
   - migrate fresh
   - seed fixtures
   - integration/authz/concurrency tests
4. `migration-upgrade`
   - restore previous schema/data fixture
   - apply migrations
   - validate invariants
5. `e2e`
   - app + PostgreSQL
   - Playwright critical flows
6. `security`
   - dependency/secret checks and targeted static checks where available

## Migration strategy

Use expand/migrate/contract for breaking schema changes.

Example authorization cutover:

1. add memberships/relations (already started);
2. backfill;
3. dual-read only long enough to validate;
4. switch all reads to new canonical model;
5. fail closed if new data missing;
6. remove legacy fallback;
7. later drop legacy columns.

Never deploy application code that requires a schema not yet safely available unless migration ordering guarantees it.

## Production deployment steps

### Pre-deploy

- all CI green
- migration reviewed
- staging smoke/UAT passed
- production backup/PITR verified current
- rollback plan written
- secrets present
- email domain/from validated
- cron disabled until app/schema ready if needed

### Deploy

1. take logical/pre-change backup if warranted;
2. apply compatible migration;
3. deploy application;
4. run post-migration validation queries;
5. run production smoke suite using test/non-destructive account;
6. enable scheduled jobs;
7. observe logs/errors/outbox/accrual metrics;
8. announce completion.

### Smoke checklist

- readiness endpoint good
- login
- org context
- employee dashboard
- request creation
- manager approval path
- audit event created
- ledger delta correct
- cancellation reversal correct
- email outbox processes
- admin reports load

## Rollback

Application rollback must not blindly reverse destructive migrations.

Prefer backward-compatible schema during release window.

If failure:

- disable writes with app read-only control if data integrity uncertain;
- stop cron workers;
- rollback app to previous compatible build;
- restore DB only if migration/data corruption requires it and after preserving forensic copy;
- document incident and add regression test.

## Scheduled jobs

- use production-only cron definitions;
- protect endpoints with `CRON_SECRET`/platform bearer mechanism;
- jobs are idempotent even if invoked twice;
- staging may use manual trigger or separate cron;
- failures surfaced to admin/alerts.

## Backups

Managed PostgreSQL backups/PITR are production source. Local `pg_dump` remains supplemental.

Perform a restore drill before go-live and record:

- backup timestamp
- restore target
- duration
- validation result
- data consistency checks

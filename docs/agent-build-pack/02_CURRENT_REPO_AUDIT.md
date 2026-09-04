# Current Repository Audit

Baseline: `main` at `9efcd068b0804f621fb56897eff5a7b2a63205f0`.

## Strong foundations to preserve

- Next.js 16 / React / TypeScript modular monolith.
- PostgreSQL + Drizzle ORM/migrations.
- Better Auth email/password with public signup disabled.
- Integer-minute accounting boundary.
- Ledger-based balance calculations.
- Employee locks and transactional paths already exist in leave/year-end code.
- Reversal behavior exists for cancellations/year close reopening.
- Policy engine is already separated from much of the HTTP/UI layer.
- Audit-event infrastructure exists.
- Holiday exclusion and workday/weekend concepts exist.
- Import/export and historical-cutover support exist.
- CSP/security headers exist.
- Playwright + Vitest + GitHub Actions exist.
- Vercel deployment is already working.

These are reasons to **evolve**, not rewrite, the application.

## Critical gaps / blockers

### A. Authorization migration is incomplete

New tables exist for:

- `organization_memberships`
- `organization_roles`
- `membership_roles`
- `reporting_relationships`

and server-side permission loading exists.

However, `authzActorFromEmployee()` still reconstructs permissions from the legacy `employees.role` field. Important server actions were switched to this synchronous helper. This means persisted custom/multiple membership roles may be ignored on those paths.

**Required:** all production request paths must obtain an actor from membership-derived permissions. Once migrated, remove production fallback to `employees.role`; allow legacy fallback only in one controlled migration/compatibility test path, then delete it.

### B. Tenant invariants are not fully enforced by the database

`membership_roles` references membership and role independently but does not by itself prove they belong to the same organization.

`reporting_relationships` references two employee IDs but must also guarantee both employees belong to `reporting_relationships.org_id`.

Application checks are necessary but these are strong data invariants worth enforcing using composite unique keys/FKs, triggers only if unavoidable, or transactionally validated write services plus migration-time consistency checks.

### C. PTO and LWOP are still combined

`src/db/demo-policy.ts` still defines:

- code `vacation_unpaid`
- name `Vacation / Unpaid`

This directly conflicts with the 2026 policy source-of-truth.

### D. Policy engine does not implement required rules

`PolicySnapshot` still lacks `noticeDays`; `notice_period` is listed as follow-on rather than enforced. Other missing policy behavior includes probation, notice period, max consecutive leave, documentation flag, LWOP eligibility and parental composition.

### E. Approval model is too primitive

Current policy storage has `approvalForRequest = none|manager|admin`. The real policy needs ordered conditional steps:

- PTO: Manager
- extended PTO: Manager -> Executive
- LWOP: Manager -> HR
- Sick: Manager
- parental: Manager/HR and policy-specific controls (final flow configurable)

A small typed ordered workflow engine is required.

### F. Notification model is not policy-correct

`notify.ts` still discovers active admins from `employees.role = admin` and sends pending messages to admins. It does not model manager + HR routing, decision notifications, durable retry or an outbox.

### G. Login rate limiting is per-process memory

README explicitly states rate limits are in-memory and not shared across serverless instances. This is insufficient as a production abuse-control guarantee. Options:

- platform/WAF rate limiting plus application controls;
- managed shared rate limiter only if platform controls are insufficient.

Do not add Redis solely for this without verifying Vercel/platform capabilities.

### H. CI is not a release gate yet

Current CI runs install, typecheck, Vitest and Playwright. It does not explicitly run:

- lint;
- production build;
- migrations against real PostgreSQL;
- DB-backed integration tests;
- migration upgrade test;
- security/tenant matrix;
- dependency/secret scanning.

### I. Backup is local plaintext only

Current `src/ops/backup.sh` is a useful developer tool but is explicitly not offsite/managed/encrypted. Production needs managed backups/PITR where supported, retention rules, and a tested restore procedure.

### J. No MFA requirement for privileged accounts

Email/password is materially better than the obsolete PIN concept, but privileged HR/admin/executive accounts should have MFA before external/public exposure or production containing real HR records.

## Medium-priority debt

- `adminNote` terminology assumes admin decisions; replace with neutral decision/comment terminology.
- `employees.managerId` and `employees.role` should become transitional/deprecated after relationship/membership cutover.
- organization selection currently falls back to the first active org if a preferred org is invalid. Prefer explicit invalid-org handling rather than silently switching context.
- health check semantics should distinguish liveness from readiness; a production readiness endpoint should fail when required dependencies are unavailable.
- README still describes demo/legacy behavior and must be rewritten after cutover.

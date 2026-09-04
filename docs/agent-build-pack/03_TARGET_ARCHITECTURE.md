# Target Architecture

## Architecture style

Use a **modular monolith** deployed as one Next.js application with one PostgreSQL database.

Logical modules:

- authentication
- organizations/memberships
- authorization
- employee/employment
- reporting relationships
- leave types/buckets
- policies
- policy evaluation
- requests
- approvals
- ledger/accounting
- accrual/year-end
- holidays/work schedules
- notifications/outbox
- imports/exports
- audit/reporting
- operations/health

Keep modules separate in code while retaining local ACID transactions across them.

## Identity and organization model

```text
Better Auth User (global identity)
  |
  +-- Organization Membership (org scoped)
        |
        +-- zero or more Roles -> closed Permission catalogue
        +-- Employee/Employment profile
        +-- reporting relationships
        +-- policy assignments
        +-- leave requests / balances
```

A single auth user may belong to multiple organizations.

### Better Auth boundary

Keep Better Auth responsible for authentication/session/account security. Keep HR-domain authorization and employment data application-owned.

Why not migrate all org authorization into Better Auth's organization plugin immediately?

- Better Auth now supports organizations and dynamic roles, so it is a viable alternative.
- The repo already has a domain-specific membership/permission model integrated with employee/reporting relationships.
- Leave authorization requires relationship/attribute checks (direct report, self-approval denial, policy override), not only RBAC.
- A second migration of security-sensitive membership data adds risk without a demonstrated functional benefit.

**Decision:** retain app-owned organization authorization for this release; Better Auth remains identity/session provider. Re-evaluate only via a separate ADR if duplication becomes costly.

## Authorization model

Use:

**RBAC + ReBAC + ABAC**

- RBAC: role grants permission strings.
- ReBAC: manager may act only on valid direct reports/effective reporting relationships.
- ABAC: same organization, employment state, leave status, effective dates, policy conditions.

Client-side permission checks are only for presentation. Server-side checks are authoritative.

## Leave accounting model

Separate:

1. **Leave Type** — what the employee requests (PTO, Sick, LWOP, Maternity, Paternity).
2. **Balance Bucket** — what accounting entitlement is consumed (Accrued PTO, Sick Allocation, Employer-Paid Parental, none).

A leave request may map to one or multiple bucket consumption components.

This is required for parental leave and avoids corrupting PTO accounting.

## Policy model

Policies are immutable/effective-dated versions composed of a closed set of typed rule primitives.

Do not create arbitrary scripts.

Rule primitives include:

- accrual schedule
- annual cap
- carryover cap
- waiting/probation restriction
- notice requirement
- negative-balance rule
- minimum increment
- work-calendar/holiday exclusion
- max consecutive duration
- tenure requirement
- documentation flag
- required approval workflow
- exceptional override capability

Policy changes create a new version rather than mutating historical policy behavior.

## Approval model

Use a **linear ordered workflow with optional conditional steps**, not a general graph/BPM engine.

Examples:

- normal PTO: Manager
- extended PTO (>2 weeks up to 3): Manager -> Executive
- LWOP: Manager -> HR
- Sick: Manager

Each request creates an approval instance whose steps and policy version are frozen for that request.

## Notifications

Use a transactional outbox:

```text
business transaction
  -> request/decision/ledger/audit
  -> notification_outbox row
commit
  -> worker sends mail
  -> mark delivered / retry with backoff
```

No business transaction depends on SMTP/Resend availability.

## Background jobs

Prefer one daily due-work scheduler rather than one hardcoded “vacation monthly” job.

Jobs discover due work from policy assignments and produce deterministic idempotency keys.

Examples:

- accrual due
- holiday materialization
- notification outbox delivery
- policy/period maintenance

Year-end close remains an explicit HR operation with preview/validate/close, not a blind cron.

## Infrastructure target

- GitHub repository
- GitHub Actions CI
- Vercel application environments
- managed PostgreSQL
- transactional email provider (or org SMTP) behind adapter
- managed DB backup/PITR
- optional error/observability provider if native platform logging is insufficient

Do not add Redis/Kafka/queues unless measured requirements justify them. PostgreSQL can hold the notification outbox and job idempotency records at this scale.

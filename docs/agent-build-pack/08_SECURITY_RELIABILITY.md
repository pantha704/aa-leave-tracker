# Security and Reliability Requirements

## Authentication

- Keep Better Auth email/password; do not return to 4-digit PIN authentication.
- Public signup disabled.
- Increase minimum password policy beyond the temporary 6-character compatibility setting before real production use; follow Better Auth capabilities and org policy.
- Add MFA for privileged roles (HR admin, org admin, executive; ideally all users).
- Session cookies: HttpOnly, Secure in production, SameSite appropriate.
- Rotate `BETTER_AUTH_SECRET` via documented procedure.
- Account recovery/reset flows must not reveal whether an email exists beyond acceptable UX trade-offs.

## Rate limiting / abuse

Current in-memory process rate limiting is not a production guarantee in serverless architecture.

Preferred order:

1. Vercel/platform firewall/rate controls for login and sensitive endpoints;
2. application lockout/backoff and audit events;
3. shared external limiter only if platform controls cannot meet requirements.

Avoid adding Redis by default.

## Authorization

See tenancy document. Fail closed after migration.

No client-only enforcement.

## CSRF and mutation safety

Audit Better Auth/Next.js mutation protections. For custom cookie-authenticated mutation endpoints:

- same-site cookie policy;
- origin/referer validation where appropriate;
- CSRF token if framework/provider does not already protect the route class;
- only intended HTTP methods;
- JSON/content-type validation.

## Input validation

Use Zod or equivalent at every external boundary.

Validate:

- UUIDs
- ISO dates
- minute quantities
- policy configuration
- permission lists
- role keys/names
- email recipients
- CSV imports

Never trust hidden form fields for org, actor or computed balances.

## SQL/data integrity

- parameterized Drizzle/SQL only;
- transactions for multi-row business invariants;
- row/employee locks for balance-changing operations;
- unique constraints for idempotency;
- same-org constraints where practical;
- migration scripts validate existing data before adding strict constraints.

## XSS / CSP

Preserve CSP/security headers already present. Re-run browser tests after any change to nonce/proxy logic.

Avoid `dangerouslySetInnerHTML` for user-controlled content. Sanitize/escape notification templates.

## Secrets

- no production secret in source, fixtures, logs or screenshots;
- separate secrets per dev/staging/prod;
- scoped DB credentials;
- email/cron secrets rotated and documented;
- secret scanning enabled in repository where available.

## Sensitive HR data

Data minimization:

- do not store medical diagnosis/details;
- sick documentation workflow should store required/received/verified metadata, not uploaded document content unless HR explicitly requires storage;
- if documents become required, design a separate secure object-storage/privacy subsystem rather than dumping blobs into leave rows.

## Logging

Structured logs include:

- request/correlation ID
- org ID
- action/job
- non-sensitive entity IDs
- result/error class

Never log:

- passwords
- session tokens
- invite/reset tokens
- SMTP credentials
- full medical notes
- secrets

## Liveness vs readiness

Provide:

- `/api/health/live`: process alive; no dependency requirement.
- `/api/health/ready`: required runtime dependencies reachable/configured; non-200 when DB unavailable.

Do not let an “always ok” endpoint be the only production health signal.

## Backups and disaster recovery

Production DB must have managed automated backups. Prefer PITR where available.

Define:

- RPO target
- RTO target
- retention
- restore owner
- quarterly restore test (or more frequently while stabilizing)

Keep local `pg_dump` utility for ad hoc export but do not call it the production backup strategy.

## Failure-mode requirements

Test explicitly:

- email provider down during submit/approve;
- duplicate cron invocation;
- DB transaction deadlock/serialization retry where relevant;
- two approvers clicking simultaneously;
- approval after balance changed;
- cancellation concurrent with approval;
- policy version changes while request pending;
- manager changed while request pending;
- year-end close invoked twice;
- app deployment while old/new schema coexist during migration.

# Execution Phases

Each phase has an exit gate. Do not begin dependent phases while critical invariants are unresolved.

## Phase 0 — Baseline and guardrails

- re-audit HEAD
- establish local PostgreSQL
- baseline tests/build
- add progress/decision log
- create CI scripts needed for full local gate

**Exit:** reproducible baseline and no unknown existing test failure.

## Phase 1 — Finish multi-org authorization migration

- canonical async membership-derived actor loader
- eliminate `authzActorFromEmployee` from production request paths
- remove legacy role fallback after backfill
- explicit org selection validation
- multi-role union honored everywhere
- cross-org constraints/tests
- reporting relationships canonical for manager checks

**Exit:** authorization matrix green; no production authority from `employees.role`.

## Phase 2 — Domain/schema foundation

- employee probation/notice fields
- work schedule model if current model cannot represent required cases cleanly
- balance buckets
- PTO/Sick/LWOP/Maternity/Paternity separation
- policy version/family semantics
- approval workflow tables
- override records
- notification outbox

Use expand/migrate/contract.

**Exit:** migrations fresh + upgrade green; data invariants validated.

## Phase 3 — ABS PTO P0 accounting

- PTO 136h cap
- full-month accrual logic
- Sick 24h annual grant
- 80h carryover
- recurring official holidays
- minimum increments
- negative-balance prevention
- migrate `vacation_unpaid` safely

**Exit:** policy accounting tests + ledger reconciliation green.

## Phase 4 — Policy rule completion

- 14-day notice
- emergency/medical override
- probation restriction
- notice-period restriction
- max consecutive 2w/3w
- sick documentation flag

**Exit:** all rule boundary tests green and policy traceability updated.

## Phase 5 — Approval workflow engine

- Manager
- Executive conditional second step
- HR second step
- rejection reason
- self-approval denial
- immutable decisions
- concurrency protection

**Exit:** approval E2E and concurrent decision tests green.

## Phase 6 — Notifications/outbox

- request routing Manager + HR
- decision routing Employee + HR
- next-step executive/HR mail
- provider adapter
- outbox retry/dead handling
- admin visibility

**Exit:** provider failure cannot affect business state; retry tests green.

## Phase 7 — Special leave

- LWOP eligibility/workflow
- make-up records/workflow
- parental multi-component accounting
- tenure/notice rules

**Exit:** special-leave policy tests green. Parental remains feature-disabled until ambiguous HR interpretation is confirmed if necessary.

## Phase 8 — UX and reporting

Employee:

- balances by bucket/type
- accrual/carryover history
- pending/approved/cancelled
- request rule feedback

Manager:

- pending direct reports
- team calendar
- decision/reason UX

HR/admin:

- employees/employment state
- roles/permissions
- reporting relationships
- policies/versions
- holidays
- approvals/overrides
- ledger adjustments
- outbox health
- audit/reports
- year-end preview

**Exit:** UAT scenarios pass without manual DB intervention.

## Phase 9 — Security and operations

- MFA privileged accounts
- production rate limiting/WAF
- liveness/readiness
- structured logging
- backup/PITR
- restore drill
- secret/dependency scanning
- error monitoring/alerts

**Exit:** security checklist and recovery drill pass.

## Phase 10 — CI/CD hard gate and staging

- complete CI matrix
- staging environment isolation
- migration upgrade test
- full E2E
- realistic seed/import
- year-end simulation

**Exit:** repeated clean CI + staging acceptance.

## Phase 11 — Production cutover

- backup
- compatible migrations
- deploy
- validate
- smoke
- enable cron
- monitor

**Exit:** production verification checklist passes.

## Phase 12 — Adversarial final review

Agent must re-read the entire pack and actively search for contradictions, shortcuts, TODOs, legacy fallbacks, skipped tests, dead code and unsafe defaults.

Run the complete suite again from clean checkout/environment.

**Exit:** Definition of Done fully satisfied.

# Risk Register and Architecture Decisions

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Legacy `employees.role` bypasses membership roles | Critical | canonical async actor loader; remove fallback; authz tests |
| Cross-org IDOR | Critical | org-scoped services, DB invariants, two-org tests |
| Duplicate accrual/usage | Critical | locks + transactions + idempotency unique keys |
| Combined Vacation/LWOP corrupts accounting | High | split leave types/buckets + migration reconciliation |
| Policy rounding over-credits PTO | High | 8160-min annual cap + deterministic accrual clamp |
| Email outage loses workflow notices | High | transactional outbox + retries/admin visibility |
| Direct email in transaction creates partial failure | High | outbox after business state commit |
| Manager relationship change rewrites history | High | effective-dated relationships + frozen approval steps |
| Policy edits change historical interpretation | High | immutable/effective policy versions |
| In-memory login limiter ineffective across serverless | High | platform/shared control before prod |
| Local-only backup mistaken for DR | High | managed backup/PITR + restore drill |
| Parental ambiguous wording implemented incorrectly | High | composable buckets + feature gate pending HR clarification |
| Migration breaks existing employee/history data | High | expand/migrate/contract + upgrade fixture/reconciliation |
| Arbitrary configurable rules become untestable | Medium | closed typed rule catalogue |
| General workflow engine becomes overbuilt | Medium | ordered typed steps only |
| RLS added incorrectly blocks workers or creates bypass | Medium/High | defer until ADR/prototype with request-scoped DB context |

## ADR-001: Evolve existing repo, do not rewrite

**Decision:** Keep current Next.js/Postgres/Drizzle/Better Auth architecture.

**Why:** ledger, transactions, migrations, policy engine, tests, UI and deployment already exist. Rewrite introduces migration/security risk without solving a foundational limitation.

## ADR-002: Modular monolith, not microservices

**Decision:** One deployable application and database.

**Why:** leave approval and accounting benefit from local ACID transactions; workload does not justify distributed systems.

## ADR-003: App-owned organization authorization, Better Auth for identity

**Alternatives:**

A. Migrate to Better Auth organization/dynamic-role plugin now.  
B. Keep app-owned memberships/roles, finish implementation.

**Decision:** B for this release.

**Why:** current domain model already exists and leave authorization requires reporting-relationship/attribute logic. Better Auth's organization plugin is capable and should remain an evaluated future option, but migrating security data again now adds risk. If duplication becomes material, create a separate measured ADR.

## ADR-004: Closed permission catalogue + configurable role bundles

**Decision:** organizations can name/create roles but permissions are selected from code-defined actions.

**Why:** flexibility without arbitrary executable security semantics.

## ADR-005: RBAC + relationship/attribute checks

**Decision:** permission alone never authorizes manager/direct-report operations.

**Why:** Manager is contextual, not global.

## ADR-006: Leave type != balance bucket

**Decision:** introduce accounting buckets independent of leave categories.

**Why:** parental leave needs multiple funding components; LWOP has no paid bucket.

## ADR-007: Typed policy primitives, no scripting

**Decision:** retain/extend policy JSON only through validated schemas and known rule codes.

**Why:** deterministic testing and security.

## ADR-008: Ordered approval workflows, not BPMN/general graphs

**Decision:** versioned linear steps with typed conditional inclusion.

**Why:** fully covers Manager, Manager->Exec, Manager->HR with far lower complexity.

## ADR-009: PostgreSQL transactional outbox

**Decision:** Postgres stores durable notification queue.

**Why:** avoids new queue infrastructure; maintains transactional consistency.

## ADR-010: Explicit year-end close

**Decision:** retain human preview/close flow.

**Why:** year-end changes balances and warrants review; cron can assist preparation but must not silently close.

## ADR-011: RLS deferred, not rejected

**Decision:** do not add PostgreSQL RLS superficially for initial controlled deployment. Require strong app tenant isolation and DB constraints. Re-evaluate before broad SaaS exposure.

**Why:** RLS is powerful but needs safe per-request DB tenant context and separate worker/migration roles; a badly configured RLS layer can create false confidence.

## ADR-012: Vercel + managed PostgreSQL remains appropriate

**Decision:** keep current deployment model unless company infrastructure requirements dictate otherwise.

**Why:** small internal app, server-rendered/web workload, low operational burden. Ensure environment isolation, cron security and managed backups.

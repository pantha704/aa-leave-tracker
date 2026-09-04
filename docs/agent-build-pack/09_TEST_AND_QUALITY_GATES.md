# Test Strategy and Quality Gates

No production-ready claim is allowed without evidence from all applicable layers.

## Test layers

### 1. Unit tests

Pure functions/rules:

- date math/timezone boundaries
- recurring Thanksgiving calculation
- workday expansion
- partial-day minutes
- accrual due dates
- annual cap rounding
- carryover
- notice rule
- probation/notice restriction
- max consecutive
- tenure
- documentation flag
- permission parsing
- workflow step resolution
- notification retry timing

### 2. Database integration tests

Run against real PostgreSQL, not only mocks.

- migrations from empty DB
- migration from previous schema fixture/snapshot
- constraints
- transaction rollback
- row locks/concurrent approvals
- idempotency uniqueness
- ledger reversals
- same-org invariants
- outbox claiming
- year-end/reopen

### 3. Authorization matrix tests

Create at least two organizations, multiple users and roles.

Cases:

- employee self read/request/cancel
- manager direct report
- manager non-report
- HR all-org access
- executive approval only when step requires it
- auditor read-only
- payroll viewer read boundaries
- org admin
- custom role composed of permissions
- multiple roles union
- same identity in Org A and Org B with different roles
- cross-org guessed IDs
- self-approval denial for every privileged role
- inactive membership

### 4. Policy integration tests

Use actual policy assignment + DB ledger + request services.

Every item in `06_PTO_POLICY_REQUIREMENTS.md` must have automated coverage.

### 5. E2E tests

At minimum:

- login and forced password-change path
- org selection/switch for multi-org user
- employee sees balance/history
- employee requests PTO
- 14-day violation and emergency override UX
- manager sees direct-report request and approves
- manager rejects with mandatory reason
- HR sees trail
- extended PTO routes executive step
- LWOP routes manager then HR
- cancellation creates restoration
- role management works and custom role is honored
- cross-org URL/ID attack is denied
- admin policy/year-end preview

### 6. Migration tests

CI must prove:

- fresh schema migrations succeed;
- seeded demo/test org succeeds;
- a representative previous-release schema upgrades without data loss;
- validation queries find zero orphan/cross-org/duplicate records after migration.

### 7. Security tests

Automated/manual where appropriate:

- authorization/IDOR
- CSRF review
- XSS/template escaping
- CSP headers
- cookie attributes
- open redirect check
- login brute-force controls
- secrets scan
- dependency audit
- unsafe method/content-type handling

## Mandatory CI command gate

Equivalent of:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:integration
bun run build
bun run test:e2e
```

If scripts do not exist, add them.

## Coverage philosophy

Do not chase arbitrary 100% line coverage. Require 100% coverage of **critical invariants and rule branches**.

Critical modules must have tests for success, denial, boundary and concurrency/error behavior.

## Mutation/bug-regression discipline

Every production bug fixed during the iteration loop must first receive a regression test when practical.

## Release blocker severity

- Critical: data loss, cross-tenant access, auth bypass, balance corruption, duplicate ledger, secret exposure. Must be zero.
- High: policy miscalculation, incorrect approval actor, unrecoverable job failure, broken migration. Must be zero.
- Medium: UX/reporting/operational deficiency. Must be resolved or explicitly accepted with owner before production.
- Low: cosmetic/non-blocking. May be tracked after launch.

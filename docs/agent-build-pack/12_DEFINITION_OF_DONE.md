# Definition of Done — 10/10 Gate

“10/10” means all critical quality dimensions meet explicit evidence gates. It does not mean the software has infinite features.

## 1. Architecture — PASS only if

- modular monolith remains understandable;
- no unjustified infrastructure;
- identity/tenant/domain boundaries are explicit;
- no production magic/demo constants drive policy behavior;
- policy/workflow extensions use typed primitives.

## 2. Policy correctness — PASS only if

- every non-ambiguous 2026 ABS rule is implemented or deliberately feature-gated;
- traceability matrix maps rule -> code -> test;
- 136h annual cap is mathematically guaranteed;
- PTO/Sick/LWOP separate;
- holiday/carryover/notice/approval behavior matches source-of-truth;
- parental ambiguity is explicitly gated, not guessed.

## 3. Authorization/tenancy — PASS only if

- membership permissions are canonical;
- global/legacy employee role grants no production authority;
- custom/multiple roles work;
- cross-org access test suite is exhaustive for protected mutations/reads;
- self-approval impossible;
- reporting relationships are effective-dated and org-safe.

## 4. Data integrity — PASS only if

- ledger is authoritative/immutable;
- all balance-changing operations transactional;
- automated events idempotent;
- cancellation/reopen use reversals;
- DB constraints guard key invariants;
- migrations validated on fresh and upgrade DB.

## 5. Concurrency/reliability — PASS only if

- simultaneous approval cannot duplicate usage;
- repeated cron cannot duplicate accrual/carryover/email;
- external email outage cannot corrupt workflow;
- job failures are visible/retriable;
- health/readiness semantics are correct.

## 6. Security — PASS only if

- no critical/high authz finding;
- privileged MFA configured/required for production scope;
- production rate limiting is shared/platform-enforced, not merely process memory;
- CSP/security headers remain valid;
- secrets separated/scanned;
- sensitive HR data minimized;
- dependency/security review completed.

## 7. Test quality — PASS only if

- lint/typecheck/build green;
- unit green;
- real PostgreSQL integration green;
- authz matrix green;
- concurrency green;
- migration fresh/upgrade green;
- E2E critical flows green;
- no skipped critical test without documented blocker.

## 8. UX — PASS only if

- employee can understand balances and request result without knowing internals;
- manager can see/action only their required approvals;
- HR can manage exceptions and records with reasons/audit;
- validation errors explain rule and corrective action;
- no normal workflow requires SQL/manual DB edits.

## 9. Operations — PASS only if

- dev/staging/prod isolated;
- deployment/runbook tested;
- backup/PITR active;
- restore drill passed;
- alerts/logs support incident diagnosis;
- cron/outbox operational state visible.

## 10. Maintainability — PASS only if

- README matches actual system;
- no obsolete `vacation_unpaid` production assumptions;
- no critical TODO/FIXME;
- ADRs explain major trade-offs;
- another engineer can set up, migrate, test, deploy and recover system using repo docs.

## Final release rule

Production release is forbidden if any Critical or High issue remains unresolved.

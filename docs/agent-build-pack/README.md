# AA Leave Tracker — 10/10 Production Build Pack

**Repository:** `pantha704/aa-leave-tracker`  
**Audited baseline:** `main` at commit `9efcd068b0804f621fb56897eff5a7b2a63205f0` (2026-09-02)  
**Primary policy source:** `docs/PTO_POLICY_2026.md`  
**Policy tracking issue:** GitHub Issue #1  

This pack is a repo-specific implementation contract for completing the leave tracker to production readiness. It is not a generic product brief and it is not permission to blindly rewrite working code.

## Required reading order

1. `01_MASTER_AGENT_PROMPT.md`
2. `02_CURRENT_REPO_AUDIT.md`
3. `03_TARGET_ARCHITECTURE.md`
4. `04_DOMAIN_AND_SCHEMA_SPEC.md`
5. `05_AUTHORIZATION_AND_TENANCY.md`
6. `06_PTO_POLICY_REQUIREMENTS.md`
7. `07_WORKFLOW_LEDGER_JOBS.md`
8. `08_SECURITY_RELIABILITY.md`
9. `09_TEST_AND_QUALITY_GATES.md`
10. `10_CI_CD_DEPLOYMENT_RUNBOOK.md`
11. `11_EXECUTION_PHASES.md`
12. `12_DEFINITION_OF_DONE.md`
13. `13_AGENT_ITERATION_PROTOCOL.md`
14. `14_RISK_REGISTER_AND_ADRS.md`
15. `acceptance_criteria.yaml`

## Operating principle

The goal is not maximum configurability or maximum infrastructure. The goal is the smallest architecture that is:

- policy-correct;
- tenant-safe;
- auditable;
- concurrency-safe;
- easy to test;
- recoverable;
- understandable by another engineer;
- inexpensive to operate;
- extensible to multiple organizations without another rewrite.

Prefer a **modular monolith + PostgreSQL**. Do not introduce microservices, Redis, Kafka, Kubernetes, a custom scripting language, or arbitrary workflow graphs unless a measured requirement proves they are necessary.

## Non-negotiable invariants

- Authentication identity is global; employment and authorization are organization-scoped.
- A user may belong to multiple organizations and hold multiple roles in each.
- Roles are permission bundles; business authorization also evaluates relationships and resource attributes.
- No cross-organization read/write is possible by guessed IDs.
- No user may approve their own leave.
- Ledger transactions are the authoritative accounting record; balances are derived.
- Ledger rows are append-only; corrections use reversals/adjustments.
- PTO, Sick, LWOP, maternity and paternity are not collapsed into one leave type.
- Leave type and balance bucket are separate concepts.
- Policies are effective-dated/versioned; historical decisions retain their policy version/snapshot.
- Approval, rejection, cancellation, override and balance adjustment are audited.
- Scheduled jobs are idempotent.
- Email delivery failure never causes accounting duplication or leaves a half-committed approval.
- Production deployment is blocked unless all quality gates in this pack pass.


# Progress

Baseline: `9efcd068b0804f621fb56897eff5a7b2a63205f0`  
Branch: `prod-10of10`  
Contract: `docs/agent-build-pack/`

| Phase | Status | Evidence |
|---|---|---|
| 0 Baseline | done | branch `prod-10of10` from `9efcd06`; pack copied to `docs/agent-build-pack/` |
| 1 Canonical membership actor | in progress | `toAuthzActor` on requireEmployee/requireAdmin; `authzActorFromEmployee` removed; empty membership permissions do not fall back to `employees.role`; invalid org selector fails closed |
| 2 Domain/schema | not started | |
| 3–12 | not started | |

## AUTHZ-001/002

Membership-derived `permissions` on the actor is canonical. `employees.role` must not grant production authority when a `permissions` array is present (including empty).

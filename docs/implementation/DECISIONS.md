# Decisions

## D1 — Production actor source

- Option A: keep `authzActorFromEmployee()` mapping `employees.role` (fast, ignores custom/multi roles).
- Option B: every request path uses `toAuthzActor()` / membership rows.
- Chosen: B. Safer for AUTHZ-001/002/007. Rollback is revert + keep membership tables.

## D2 — Invalid org selector

- Option A: fall back to first active membership (current).
- Option B: fail closed (403 / unauthenticated) if selector is not a membership, or if multiple memberships exist with no selector.
- Chosen: B per build pack. Single membership still auto-selects.

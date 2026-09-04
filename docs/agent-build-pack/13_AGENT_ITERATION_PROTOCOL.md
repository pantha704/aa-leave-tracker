# Agent Iteration Protocol

This protocol is designed for an autonomous coding agent that should continue refining the repository until the acceptance contract passes.

## Persistent state files the agent should maintain

Inside its branch/worktree, maintain:

- `docs/implementation/PROGRESS.md`
- `docs/implementation/DECISIONS.md`
- `docs/implementation/KNOWN_ISSUES.md`
- `docs/implementation/TEST_EVIDENCE.md`

These become part of the PR unless project maintainers prefer them squashed into final docs.

## Iteration loop

Repeat:

### 1. Inspect

- git status/diff
- current failing tests
- acceptance criteria not yet satisfied
- recent migrations
- authorization/data-integrity impact

### 2. Select smallest meaningful slice

Prefer one invariant or tightly coupled group.

Examples:

- replace legacy actor creation across all admin server actions;
- add same-org role constraint + migration + tests;
- implement notice rule end-to-end.

### 3. Design critique

For any architecture-sensitive slice, record:

- Option A
- Option B
- chosen option
- why it is safer/simpler
- migration/rollback impact

Do not spend this ceremony on trivial renames.

### 4. Implement

- code
- migration
- tests
- docs

### 5. Targeted verification

Run relevant tests first.

### 6. Full gate

At phase boundary run all:

- lint
- typecheck
- unit
- integration
- build
- E2E

### 7. Adversarial self-review

Search for:

- legacy role usage
- `vacation_unpaid`
- `adminNote`
- admin-email lookup by legacy role
- missing org filters
- client-trusted org IDs
- balance mutation outside ledger
- network send in DB transaction
- non-idempotent scheduled writes
- TODO/FIXME/skipped tests
- weak fail-open catch blocks
- missing migration constraints

### 8. Fix review findings

Do not defer critical/high findings to later phases.

### 9. Commit cohesive change

Use descriptive commit message.

### 10. Update progress evidence

Only mark acceptance item passed with command/test/file evidence.

## Stopping conditions

Stop successfully only when:

- every mandatory item in `acceptance_criteria.yaml` is `pass` with evidence;
- complete clean quality gate passes;
- final adversarial review finds no Critical/High;
- staging/deployment prerequisites are documented.

Stop blocked only when code cannot resolve an external dependency/decision. Examples:

- production DB/email credentials unavailable;
- HR has not clarified parental interpretation required to enable that feature;
- platform plan lacks required production capability.

When blocked:

- do not fake success;
- leave feature safely disabled if necessary;
- state exact decision/value needed;
- ensure unrelated tests remain green.

## Anti-loop control

If the same test/failure recurs after three materially different attempted fixes:

1. stop patching symptoms;
2. re-read the relevant architecture and upstream library docs;
3. reduce to a minimal reproduction;
4. identify root cause;
5. change design if needed;
6. document the failed approaches.

This prevents endless low-quality tweak loops.

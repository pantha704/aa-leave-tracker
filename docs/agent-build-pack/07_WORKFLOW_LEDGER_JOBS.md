# Workflows, Ledger, Accrual and Jobs

## Approval workflow design

Use ordered typed steps.

A request submission resolves and freezes:

- policy version
- applicable rules
- required approval workflow version
- calculated leave days/minutes
- required approval steps

A later policy/manager change must not silently rewrite completed history. Pending workflow reassignment must be explicit and audited if required.

### Approval state machine

Suggested request states:

- draft
- pending
- approved
- rejected
- cancelled

Approval instance/step states:

- waiting
- pending
- approved
- rejected
- skipped (only by explicit typed condition)
- cancelled

Only the next pending step can be acted upon.

Rejection reason is mandatory.

## Atomic approval transaction

Approval must execute under employee/request lock and transaction:

1. reload request + active workflow step;
2. verify actor authorization and same org;
3. verify not self;
4. re-evaluate frozen/policy-sensitive invariants that can change (balance, employment status, closed period, overlaps);
5. record step decision;
6. if additional step remains, advance workflow and enqueue notification;
7. if final approval, mark leave approved and post ledger usage;
8. write audit events;
9. enqueue notification outbox rows;
10. commit.

No email network call inside this transaction.

## Ledger design

Balance is always derived from immutable ledger events.

Kinds should be semantically explicit, e.g.:

- accrual
- annual_grant
- usage
- reversal
- carryover
- forfeiture
- adjustment
- parental_company_paid_grant/usage where applicable

Every automated ledger event has deterministic idempotency.

## Accrual scheduling

Replace hardcoded vacation-code targeting with policy-assignment discovery.

Recommended worker cadence: daily.

For each active assignment:

- determine whether an accrual is due as of org-local date;
- calculate amount under policy version;
- clamp against annual/accrual stop cap;
- skip dates after employment end;
- post with deterministic key;
- audit job run summary.

For ABS, “full month” should default to hire-date anniversary interpretation unless HR explicitly configures calendar-month accrual. The policy language supports anniversary/full-month interpretation better than partial calendar-month credit.

## Idempotency

Examples:

```text
accrual:{org}:{employee}:{policyVersion}:{dueDate}
carryover:{org}:{employee}:{bucket}:{fromYear}:{toYear}
holiday:{calendar}:{date}
notification:{eventType}:{aggregateId}:{recipient}:{version}
```

Unique DB constraint on key where appropriate.

A repeated cron/job must be harmless.

## Year-end close

Keep explicit HR operation.

Workflow:

1. Preview
2. Validate
3. Produce signed/hashable snapshot/report
4. Mark period closing
5. lock impacted employees
6. re-plan inside transaction
7. post carryover/forfeiture/sick grants
8. freeze period/history as designed
9. open next period
10. commit
11. audit

Reopen uses reversals, never deletes history.

### ABS close

- carryover PTO up to 4800 min
- do not lump-grant next year's 8160 PTO if monthly accrual policy applies
- grant next-year Sick allocation as policy specifies

## Notification outbox worker

Use Postgres as durable queue initially.

Algorithm:

- claim limited pending rows using transaction/locking (`FOR UPDATE SKIP LOCKED` or equivalent safe strategy);
- mark/send with bounded timeout;
- success -> sent timestamp;
- transient failure -> exponential/backoff next attempt;
- permanent/dead after bounded attempts -> visible admin alert;
- never log auth secrets/full SMTP URL.

## Cron endpoint

If Vercel Cron is used:

- authenticate cron requests with strong secret/bearer mechanism;
- endpoint itself remains idempotent;
- no cron endpoint can perform arbitrary org/user-supplied actions;
- record job start/end/result counts;
- alert on repeated failures.

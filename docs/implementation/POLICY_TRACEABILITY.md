# Policy-to-code traceability

| Rule | Code | Test |
|---|---|---|
| PTO 17d / 8160 min cap | `DEMO_VACATION_GRANT_MINUTES`, `policies.takeCeilingMinutes` | `src/db/schema.test.ts` |
| Sick 3d / 1440 min | `DEMO_SICK_GRANT_MINUTES` | `src/db/schema.test.ts` |
| PTO vs Sick vs LWOP types | `DEMO_PTO_TYPE_CODE`, `DEMO_SICK_TYPE_CODE`, `DEMO_LWOP_TYPE_CODE`, seed | `src/db/seed.ts` |
| Carryover 80h / 4800 min | `DEMO_PTO_CARRYOVER_MINUTES` | `src/db/schema.test.ts` |
| Jan 1 / Thanksgiving / Dec 25 | `officialAbsHolidayDates` | `src/server/policy/abs-holidays.test.ts` |
| 14-day notice + emergency/medical exception | `noticePeriod` | `src/server/policy/rules/notice-period.test.ts` |
| Negative balance | `negativeBalance` | `src/server/policy/engine.test.ts` |
| Min increment 60 | `minIncrement` | `src/server/policy/engine.test.ts` |
| Accrual periodic, not type-code magic | `jobs/accrual.ts` grantMode=periodic | `src/jobs/accrual.test.ts` |
| Rejection requires comment | `decideLeave` `DECISION_COMMENT_REQUIRED` | `src/server/leave/decide.test.ts` |
| Self-approval denied | `canApproveLeave` | `src/server/authz.test.ts` |
| Membership permissions canonical | `toAuthzActor`, `authorizeAdmin` | `src/server/auth-gate.test.ts` |
| Outbox idempotency | `enqueueOutbox` | `src/server/notify-outbox.test.ts` |

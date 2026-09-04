# ABS PTO Policy — Implementation Requirements

`docs/PTO_POLICY_2026.md` remains the authoritative detailed policy translation. This document maps it to implementation behavior and tests.

## Core entitlement

### PTO

- eligible full-time employees
- 17 accrued days / 136 hours annual hard cap
- 8-hour standard workday unless employee schedule explicitly differs
- accrue after each full month of active employment
- policy text 11.34h/month is rounded language; system must not exceed 136h/year
- usable only after earned unless explicit authorized override
- carryover max 10 unused PTO days / 80h

### Sick

- 3 days / 24h annual allocation
- non-monthly-accruing
- separate bucket from PTO
- manager approval
- >2 consecutive workdays flags `documentation_may_be_required`

### Holidays

Do not deduct PTO for:

- Jan 1
- Thanksgiving (4th Thursday in November)
- Dec 25

No observed-day substitution unless HR later configures it.

## Request rules

### Normal PTO

- at least 14 calendar days before start date
- Manager approval required
- partial-day full/half/hourly supported
- default minimum 60 minutes
- reject if insufficient accrued balance unless authorized advance-PTO exception exists

### Emergency/medical exception

- may bypass 14-day notice
- must record exception category/reason
- audit actor/timestamp

### Probation

- ordinary PTO generally unavailable
- emergency 1–2 day manager exception
- employee-specific probation end date; no invented global probation duration

### Notice period

- ordinary PTO generally unavailable
- explicit audited exception only

### Consecutive duration

- <=2 consecutive weeks: normal Manager workflow
- >2 weeks and <=3 weeks: requires Manager + Executive
- >3 weeks: no automatic standard-PTO approval; must be handled as explicit exceptional policy/HR process

### LWOP

- separate leave type
- no paid balance deduction
- available only exceptionally after accrued PTO exhausted (unless an explicitly authorized documented exception is added)
- Manager + HR prior approval

### Make-up time

Separate records/workflow, not PTO ledger credit.

Track:

- missed date
- make-up date/hours
- reason
- manager decision
- timestamp
- completion status if required

### Parental leave

Eligibility: at least 3 years employment.

Notice: 2 months.

Maternity policy states:

- duration 3 months
- 20 PTO days + 40 company-paid days

Paternity policy states:

- duration 2 months
- 20 PTO days + 20 company-paid days

The wording mixes months and paid-day components. Architecture must preserve composability and **must not invent a destructive conversion**. Before enabling parental production approval, HR must confirm the exact calendar/workday interpretation and how the 20 PTO days interact with the employee's currently accrued PTO balance. This is a business-go-live configuration checkpoint, not a reason to corrupt the general data model.

## Email trail

Normal request:

- Manager receives action request
- HR receives/copies the request trail

Decision:

- Employee receives decision
- HR receives/copies decision

Extended leave additionally routes required Executive step.

Email delivery is not the approval authority; the in-app immutable decision is.

## Required policy tests

At minimum:

- annual accrual totals exactly 8160 minutes, never 8165/8164/etc;
- first accrual only after full month;
- terminated employees stop accrual after end date;
- 80h carryover cap;
- sick grant 1440 minutes and no PTO merge;
- holiday inside PTO deducts zero for holiday;
- weekend/non-workday deducts zero;
- 14-day boundary exactly passes/fails correctly;
- emergency override recorded;
- insufficient balance denied;
- partial-day increments validated;
- probation regular PTO denied;
- probation 1–2 day emergency override path tested;
- notice-period restriction tested;
- 2-week/3-week approval routing tested;
- sick >2 workdays flag tested;
- LWOP requires exhausted PTO and Manager+HR;
- parental tenure and notice tested;
- cancellation restores via reversal, never delete/update old ledger usage.

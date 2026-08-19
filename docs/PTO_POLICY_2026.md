# Absolute Addiction PTO Policy — Application Source of Truth

**Effective:** 2026-01-01  
**Owner:** Human Resources  
**Purpose:** This file translates the approved PTO policy into implementation requirements for this repository. Code, tests, seed data, UI copy, imports, reports, and email flows must conform to this file unless HR updates the policy.

## 1. Eligibility and core balances

- Policy applies to eligible full-time employees.
- Standard workday: **8 hours**.
- Annual paid leave entitlement is composed of:
  - **Accrued PTO:** 17 days / 136 hours per calendar year.
  - **Sick Leave:** 3 days / 24 hours per calendar year; does **not** accrue monthly.
  - Combined headline entitlement: up to 20 days / 160 hours.
- Accrued PTO becomes usable only after it has been earned, unless management explicitly approves an exception.
- Sick Leave is a separate balance and must not be merged into accrued PTO accounting.
- LWOP is a separate leave category and must not be represented as PTO or included in the PTO balance.

## 2. Accrual

- Accrued PTO is earned monthly after each **full month of active employment**.
- Policy states a monthly rate of **1.42 days / 11.34 hours**.
- Annual entitlement remains **17 days / 136 hours** and must be treated as the hard annual accrual cap.
- Do not over-credit due to monthly rounding. The ledger may use a year-end remainder/rounding correction so the annual total never exceeds 136 hours.
- Accrual must stop after employment ends.
- Accrual and usage are separate immutable ledger transactions; never overwrite a calculated balance.

### Arithmetic note

11.34 hours × 12 = 136.08 hours, which conflicts with the stated 17-day/136-hour annual entitlement. Until HR issues a correction, the application must preserve the **17-day / 136-hour annual cap** and treat the monthly figure as rounded policy language.

## 3. Carryover

- Accrued PTO carries forward during the calendar year.
- At calendar year-end, an employee may carry forward at most **10 unused accrued PTO days / 80 hours** into the next year.
- Sick Leave does not accrue and must not be carried as accrued PTO.
- Year-end close and carryover must remain auditable ledger operations.

## 4. Company holidays

The following paid company holidays do not consume PTO:

- New Year’s Day — January 1.
- Thanksgiving Day — fourth Thursday in November.
- Christmas Day — December 25.

If a company holiday falls inside approved PTO, that holiday contributes **0 PTO hours** to the leave deduction. Weekends and company holidays must therefore be excluded from ordinary PTO usage calculations according to the employee work calendar.

## 5. Partial leave

- PTO may be used as a full day, half-day, or hourly block, subject to approval and operational needs.
- The default minimum hourly increment is **1 hour** unless HR configures a stricter rule.
- Internal accounting remains integer minutes; UI may display hours/days.

## 6. Request timing and approval

- Normal PTO requests must be submitted at least **14 calendar days before the requested start date**.
- Emergency illness or medical emergency may bypass the 14-day notice rule.
- Employees must notify their Manager as soon as reasonably possible for emergency/medical leave.
- A normal request is not approved until the **Manager** approves it in writing.
- Approval communication must include the employee and HR.
- The application may generate the required email trail, but it must preserve the Manager as the approving actor.
- Rejection/denial requires a non-empty reason.
- Every approval, denial, cancellation, exception, and override must be audited with actor and timestamp.

## 7. Sick Leave

- Annual Sick Leave allocation: **3 days / 24 hours**.
- Sick Leave does not accrue monthly.
- Manager approval is required.
- For more than **2 consecutive workdays** of Sick Leave, the application must flag that medical documentation **may be required**. This is a flag/workflow requirement, not an automatic medical determination.

## 8. Cancellation/change of approved leave

- Approved leave that will not be taken must be cancelled or adjusted with Manager and HR notification.
- Never delete approved usage history. Cancellation must create a reversal/restoration transaction and retain the original record.

## 9. Make-up time

Make-up time is separate from PTO.

- Employee must make a written request.
- Manager must approve in advance.
- Approval is discretionary and based on operational needs.
- Track make-up date/hours, related missed date, reason, approver, approval timestamp, and notes.
- Do not automatically treat make-up hours as PTO accrual.

## 10. Consecutive and extended leave

- Standard PTO normally should not exceed **2 consecutive weeks**.
- Extended leave up to **3 consecutive weeks** may be approved only with **Executive Management approval**.
- Requests beyond 3 consecutive weeks are outside the stated standard PTO rule and must not be auto-approved.
- The system must distinguish ordinary manager approval from the extra executive approval required for extended leave.

## 11. Leave Without Pay (LWOP)

LWOP is exceptional and separate from PTO.

- It may be considered after accrued PTO has been used/exhausted.
- It requires prior written approval from both the **Manager and HR**.
- Emergency personal/family situations may support an LWOP request.
- The application must not automatically grant LWOP merely because PTO is exhausted.
- LWOP should not reduce the paid PTO ledger balance.

## 12. Probation period

- PTO during probation is generally not approved.
- Emergency exception: Manager may approve **1 or 2 days**.
- Because the policy does not define a universal probation length, HR must store each employee’s probation end date/status; the application must not invent one.
- Any probation exception requires an auditable reason and approving Manager.

## 13. Notice period

- PTO during an employee’s notice period is generally not approved.
- HR must store the employee’s notice-period start date/status rather than infer it from the termination date.
- Any exception must be explicit and audited.

## 14. Parental leave

### Maternity

- Eligibility: at least **3 years** with the Company.
- Duration stated by policy: **3 months**.
- Paid composition stated by policy: **20 days of PTO + 40 additional company-paid days**.

### Paternity

- Eligibility: at least **3 years** with the Company.
- Duration stated by policy: **2 months**.
- Paid composition stated by policy: **20 days of PTO + 20 additional company-paid days**.

### Notice

- Employee must notify Manager and HR at least **2 months in advance**.
- Parental leave must not be implemented as a simple single-balance deduction because the policy explicitly splits PTO-funded and additional company-paid days.

## 15. Employee/HR record responsibilities

HR maintains the official PTO records. The application should act as the system of record for:

- accrual transactions;
- carryover;
- leave requests and statuses;
- approvals/denials and reasons;
- PTO/Sick/LWOP/parental categories;
- usage deductions and reversals;
- make-up time;
- exceptions/overrides;
- audit history.

Employees must be able to review their balances/history and report discrepancies.

## 16. Required leave categories

At minimum, production should expose distinct categories for:

- `pto` — accrued Paid Time Off;
- `sick` — annual non-accruing Sick Leave;
- `lwop` — Leave Without Pay;
- `maternity`;
- `paternity`;
- other/bonus leave only when HR explicitly configures it.

Do **not** use a combined “Vacation / Unpaid” leave type in production.

## 17. Security and accounting invariants

- Server-side authorization only; client controls never determine balances or approvals.
- Employees may read only their own private records unless their role permits broader access.
- Manager approval must be constrained to employees assigned to that manager.
- HR/admin overrides require reason + audit entry.
- Pending, denied/rejected, and cancelled requests must not reduce the official paid balance.
- Approved paid usage creates ledger deductions.
- Approved cancellation creates reversal transactions.
- Company holidays inside leave ranges create no paid-leave deduction.
- Never directly overwrite a calculated balance.

## 18. Implementation priority

1. Correct PTO/Sick/LWOP separation and seed values.
2. Correct monthly accrual and 10-day carryover.
3. Official holiday generation/exclusion.
4. 14-day notice + emergency override.
5. Manager approval + mandatory denial reason + policy-compliant email routing.
6. Probation/notice-period and max-consecutive rules.
7. Sick-documentation flag.
8. Make-up time.
9. LWOP workflow.
10. Parental leave multi-bucket accounting.

See GitHub issue #1 for the implementation checklist.
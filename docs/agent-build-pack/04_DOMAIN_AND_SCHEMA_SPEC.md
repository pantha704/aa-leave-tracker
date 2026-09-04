# Domain and Schema Specification

This is a logical target. The agent must map it onto the current schema with safe incremental migrations rather than rebuilding tables unnecessarily.

## 1. Organizations

Required fields:

- id
- name
- slug (unique)
- timezone (IANA, required)
- locale
- standard_workday_minutes
- active
- created_at / updated_at

Existing organization settings may remain separate.

## 2. Memberships and roles

### organization_memberships

- id
- org_id
- auth_user_id
- employee_id (if employment profile is required for membership)
- active/status
- created_at

Constraints:

- unique `(org_id, auth_user_id)` when auth user exists
- employee belongs to exactly the same org as membership
- no orphan membership-role mappings

### organization_roles

- id
- org_id
- key
- display name
- permissions (validated against the closed code catalogue)
- protected/system role flag if needed

Unique `(org_id, key)`.

### membership_roles

- membership_id
- role_id

Must enforce same-org invariant.

### Legacy cutover

`employees.role` becomes transitional only. After backfill and validation:

1. all authority reads membership roles;
2. remove compatibility fallback;
3. remove/deprecate `employees.role` after all dependent code/tests are migrated.

Likewise `employees.auth_user_id` may become transitional if membership is the canonical identity link.

## 3. Employment profile

Keep current `employees` table if practical, but evolve it to represent organization employment, not authentication authority.

Required data:

- org_id
- name/email display data as needed
- employee number (optional but useful)
- start_date
- end_date
- employment_type
- employment_status
- work_schedule_id or workday override
- probation_end_date
- notice_period_start_date
- active

Do not infer probation length because policy does not define one.

## 4. Reporting relationships

`reporting_relationships`:

- org_id
- employee_id
- manager_employee_id
- effective_from
- effective_to
- is_primary

Invariants:

- no self reporting
- both employees belong to org_id
- dates valid
- at most one active primary manager per employee
- historical relationships retained

During migration, keep `employees.manager_id` only as compatibility; migrate all reads to effective relationships then remove it.

## 5. Work schedules and holidays

### work_schedules

- org_id
- name
- timezone or inherit org
- effective dates

### work_schedule_days

- schedule_id
- ISO weekday
- scheduled minutes

### holiday_calendars / holiday_instances

If current simple `holidays` table is sufficient for initial org-specific calendar, keep it. Add a rule/materializer layer for recurring holidays.

ABS recurring rules:

- Jan 1
- fourth Thursday in November
- Dec 25

Do not invent observed-day substitution.

## 6. Leave types and buckets

### leave_types

Keep organization-scoped leave categories.

Required production types for ABS:

- `pto`
- `sick`
- `lwop`
- `maternity`
- `paternity`

Remove production use of `vacation_unpaid`.

### balance_buckets (new)

Suggested fields:

- id
- org_id
- code
- name
- unit (`minutes` internally)
- allow_negative
- active

ABS initial buckets:

- `pto_accrued`
- `sick_annual`
- `parental_company_paid` (or gender-specific policy components if HR requires)

LWOP consumes no paid balance bucket.

### leave_type_bucket_rules

Maps request type to accounting components/priority.

For simple PTO/Sick: one bucket.
For parental: policy-specific components.

## 7. Policies

Current `policies` table already has effective dates and useful fields. Evolve it into immutable policy versions rather than replacing it wholesale.

Add a stable policy family/key if needed:

- policy_family_key
- version or immutable row identity
- effective_from/to
- status (draft/active/retired)

Once a policy has been used by a submitted/approved request, protected fields should not be edited in place. Create a new effective version.

Policy snapshots or policy version IDs must be stored on leave requests/approval instances.

## 8. Approval workflow

### approval_workflow_templates

- org_id
- key
- version
- effective dates/status

### approval_workflow_steps

- template_id
- ordinal
- approver_kind (`direct_manager`, `permission`, `specific_role`)
- required_permission if applicable
- condition_code/typed params (optional)

Do not store executable expressions.

### approval_instances

- leave_entry_id
- workflow_template/version
- state
- created_at

### approval_instance_steps

Freeze actual required steps for request:

- ordinal
- approver kind/permission
- status
- acted_by
- acted_at
- decision_comment

Self-approval is always prohibited.

## 9. Policy overrides

Dedicated record:

- id
- org_id
- leave_entry_id
- rule_code
- reason (required)
- approved_by
- approved_at
- metadata

Do not hide overrides only in notes.

## 10. Ledger

Migrate ledger authority from leave type to **balance bucket** if required for parental composition.

Required fields/concepts:

- org_id
- employee_id
- bucket_id
- kind/event_type
- signed minutes or explicit direction
- effective_on
- source_type/source_id
- reason
- idempotency_key
- created_by/created_at
- reversal_of / reversed_at as current design supports

Invariants:

- immutable financial/accounting history
- deterministic uniqueness for accrual/carryover jobs
- no direct balance column as source of truth

## 11. Notification outbox

- id
- org_id
- event_type
- aggregate_type/id
- recipient payload (or normalized recipient rows)
- template key/version
- payload JSON
- state (`pending`, `sending`, `sent`, `failed`, `dead`)
- attempts
- next_attempt_at
- last_error (sanitized)
- created_at / sent_at
- idempotency key

No secrets in payload/logs.

## 12. Audit

Every security/HR mutation must include:

- organization
- actor
- action
- entity type/id
- timestamp
- before/after when appropriate
- reason where required
- correlation/request ID if available

Do not include passwords, reset tokens, medical content or secrets.

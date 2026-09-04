# Authorization and Tenancy

## Permission catalogue

Keep a **closed, code-defined permission catalogue**. Organizations may create role names and bundles, but they cannot invent executable permissions.

Current catalogue is a good start. Evolve only when a real action requires it.

Suggested categories:

- organization.read/manage
- role.read/manage
- employee.read.self/team/all
- employee.manage
- leave.request.self
- leave.cancel.self
- leave.read.self/team/all
- leave.approve.direct_reports
- leave.approve.hr
- leave.approve.executive
- leave.override.policy
- policy.read/manage
- ledger.read/adjust
- audit.read
- reports.read

## Production actor

Make active organization required in the authorization context:

```text
AuthzActor {
  authUserId
  employeeId/membershipId
  organizationId
  permissions[]
}
```

Do not allow a production actor with no organization ID for org-scoped domain operations.

## Eliminate legacy authority

Mandatory cutover sequence:

1. Backfill organization memberships and role assignments for all employees.
2. Compare derived legacy permissions with membership permissions and report mismatches.
3. Change every page/action/API/service to call one canonical async actor loader.
4. Remove calls to `authzActorFromEmployee()` from production code.
5. Remove `permissionsForLegacyRole()` fallback from production membership resolution.
6. Fail closed if membership tables/data are missing after migration.
7. Remove/deprecate old role authority fields.
8. Tests must prove custom/multiple roles are honored on every protected server path.

## Organization selection

Treat active-org header/cookie as an **untrusted selector**, not proof of membership.

Server process:

1. authenticate session;
2. load memberships for auth user;
3. if selector matches one membership, activate it;
4. if selector is absent and exactly one active membership exists, use it;
5. if multiple exist and selector is absent, use explicit persisted active-org selection or show org chooser;
6. if selector does not belong to user, return 403/invalid-org response; do not silently switch to another org.

## Resource authorization template

Every org resource access should conceptually evaluate:

```text
actor authenticated
AND actor.organization_id == resource.organization_id
AND actor has required permission
AND relationship/attribute constraint passes
AND operation-specific state constraint passes
```

Examples:

### Manager approval

- same org
- permission `leave.approve.direct_reports`
- actor is effective primary/authorized manager for employee on relevant date
- actor != employee
- request is awaiting that workflow step

### HR approval

- same org
- `leave.approve.hr`
- actor != employee
- step requires HR permission

### Employee read

- same org
- resource employee == actor employee
- `employee.read.self`

## IDOR/tenant test matrix

For every route/action accepting IDs, test:

- valid same-org allowed;
- same role but other org denied;
- random UUID returns 404 or safe 403 without leaking existence;
- other employee same org denied unless relationship/permission permits;
- inactive membership denied;
- disabled organization denied;
- self-approval denied even for org admin/executive;
- role in Org A never grants authority in Org B.

## Database defense

Application authorization remains primary because all server connections generally use the same DB credential.

Strengthen with:

- org IDs on tenant-owned rows;
- composite uniqueness/FKs where practical;
- same-org constraints for membership-role and reporting relations;
- repository/service APIs that require org ID;
- automated cross-org tests.

### Row-Level Security

PostgreSQL RLS is a valid defense-in-depth option, but it is not free: the app must safely set per-request tenant context and background jobs/migrations require carefully separated database roles. Do not bolt it on superficially.

**Gate:** before exposing the product as a general multi-customer SaaS, run an ADR/prototype for RLS. Adopt only if request-scoped DB context and worker roles can be proven safe in integration tests. For the initial controlled deployment, strict app authorization + DB tenant invariants + exhaustive isolation tests is preferred over poorly configured RLS.

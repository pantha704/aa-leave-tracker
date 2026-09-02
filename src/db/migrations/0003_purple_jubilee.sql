CREATE TABLE "membership_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_id_unique" UNIQUE("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"auth_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "organization_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"permissions" text[] NOT NULL,
	CONSTRAINT "organization_roles_org_id_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "reporting_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"manager_employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_primary" boolean DEFAULT true NOT NULL,
	CONSTRAINT "reporting_relationships_not_self" CHECK ("reporting_relationships"."employee_id" <> "reporting_relationships"."manager_employee_id"),
	CONSTRAINT "reporting_relationships_dates" CHECK ("reporting_relationships"."effective_to" IS NULL OR "reporting_relationships"."effective_to" >= "reporting_relationships"."effective_from")
);
--> statement-breakpoint
DROP INDEX "employees_auth_user_id_unique";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "organizations"
SET "slug" = lower(regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr("id"::text, 1, 8)
WHERE "slug" IS NULL OR "slug" = '';--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_id_organization_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_organization_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."organization_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_relationships" ADD CONSTRAINT "reporting_relationships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_relationships" ADD CONSTRAINT "reporting_relationships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_relationships" ADD CONSTRAINT "reporting_relationships_manager_employee_id_employees_id_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_org_auth_user" ON "organization_memberships" USING btree ("org_id","auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_relationships_one_primary" ON "reporting_relationships" USING btree ("org_id","employee_id") WHERE "reporting_relationships"."is_primary" = true AND "reporting_relationships"."effective_to" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_auth_user_unique" ON "employees" USING btree ("org_id","auth_user_id") WHERE "employees"."auth_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_nonempty" CHECK ("organizations"."slug" <> '');--> statement-breakpoint
INSERT INTO "organization_roles" ("org_id", "key", "name", "permissions")
SELECT o."id", r."key", r."name", r."permissions"
FROM "organizations" o
CROSS JOIN (
  VALUES
    ('employee', 'Employee', ARRAY['employee.read.self','leave.request.self','leave.cancel.self']::text[]),
    ('manager', 'Manager', ARRAY['employee.read.self','leave.request.self','leave.cancel.self','employee.read.team','leave.read.team','leave.approve.direct_reports']::text[]),
    ('hr', 'Hr', ARRAY['employee.read.self','leave.request.self','leave.cancel.self','employee.read.all','leave.read.all','leave.approve.hr','leave.override.policy','policy.read','ledger.read','employee.manage','audit.read']::text[]),
    ('org_admin', 'Org Admin', ARRAY['employee.read.self','leave.request.self','leave.cancel.self','employee.read.all','leave.read.all','leave.approve.hr','leave.override.policy','policy.read','ledger.read','employee.manage','audit.read','employee.read.team','leave.read.team','leave.approve.direct_reports','leave.approve.executive','policy.manage','ledger.adjust','role.manage','organization.manage']::text[])
) AS r("key", "name", "permissions")
ON CONFLICT ("org_id", "key") DO NOTHING;--> statement-breakpoint
INSERT INTO "organization_memberships" ("org_id", "employee_id", "auth_user_id")
SELECT e."org_id", e."id", e."auth_user_id"
FROM "employees" e
ON CONFLICT ("employee_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "membership_roles" ("membership_id", "role_id")
SELECT m."id", r."id"
FROM "organization_memberships" m
INNER JOIN "employees" e ON e."id" = m."employee_id"
INNER JOIN "organization_roles" r ON r."org_id" = m."org_id"
  AND r."key" = CASE e."role" WHEN 'admin' THEN 'org_admin' WHEN 'manager' THEN 'manager' ELSE 'employee' END
ON CONFLICT ("membership_id", "role_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "reporting_relationships" ("org_id", "employee_id", "manager_employee_id", "effective_from", "is_primary")
SELECT e."org_id", e."id", e."manager_id", e."start_date", true
FROM "employees" e
WHERE e."manager_id" IS NOT NULL AND e."manager_id" <> e."id";
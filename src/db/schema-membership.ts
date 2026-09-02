import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";
import { employees, organizations } from "./schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const isoDate = (name: string) => date(name, { mode: "string" });

export const organizationRoles = pgTable(
  "organization_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    permissions: text("permissions").array().notNull(),
  },
  (t) => [unique("organization_roles_org_id_key_unique").on(t.orgId, t.key)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    authUserId: text("auth_user_id").references(() => user.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("organization_memberships_employee_id_unique").on(t.employeeId),
    uniqueIndex("organization_memberships_org_auth_user").on(t.orgId, t.authUserId),
  ],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organizationMemberships.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => organizationRoles.id),
  },
  (t) => [unique("membership_roles_membership_id_role_id_unique").on(t.membershipId, t.roleId)],
);

export const reportingRelationships = pgTable(
  "reporting_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    managerEmployeeId: uuid("manager_employee_id")
      .notNull()
      .references(() => employees.id),
    effectiveFrom: isoDate("effective_from").notNull(),
    effectiveTo: isoDate("effective_to"),
    isPrimary: boolean("is_primary").notNull().default(true),
  },
  (t) => [
    check(
      "reporting_relationships_not_self",
      sql`${t.employeeId} <> ${t.managerEmployeeId}`,
    ),
    check(
      "reporting_relationships_dates",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    uniqueIndex("reporting_relationships_one_primary")
      .on(t.orgId, t.employeeId)
      .where(sql`${t.isPrimary} = true AND ${t.effectiveTo} IS NULL`),
  ],
);

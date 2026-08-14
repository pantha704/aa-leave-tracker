import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

// weekend_days: ISO 8601 (1=Mon … 7=Sun). Default Sat+Sun = {6,7}.

const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return "citext";
  },
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const isoDate = (name: string) => date(name, { mode: "string" });

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    standardWorkdayMinutes: integer("standard_workday_minutes").notNull(),
    weekendDays: integer("weekend_days")
      .array()
      .notNull()
      .default(sql`'{6,7}'`),
    teamCalendarShowType: boolean("team_calendar_show_type").notNull().default(false),
    yearAnchor: text("year_anchor").notNull().default("calendar"),
    editWindowDays: integer("edit_window_days").notNull().default(7),
    forceExplicitType: boolean("force_explicit_type").notNull().default(true),
  },
  (t) => [
    check("organizations_timezone_nonempty", sql`${t.timezone} <> ''`),
    check("organizations_workday_positive", sql`${t.standardWorkdayMinutes} > 0`),
  ],
);

export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id),
  appReadonly: boolean("app_readonly").notNull().default(false),
  selfLogEnabled: boolean("self_log_enabled").notNull().default(true),
  requestsEnabled: boolean("requests_enabled").notNull().default(true),
  teamCalendarEnabled: boolean("team_calendar_enabled").notNull().default(false),
  /** Jobs that honor this flag must skip `effective_on` after `employees.end_date`. */
  accrualJobEnabled: boolean("accrual_job_enabled").notNull().default(true),
  emailEnabled: boolean("email_enabled").notNull().default(false),
});

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    email: citext("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    managerId: uuid("manager_id").references((): AnyPgColumn => employees.id),
    startDate: isoDate("start_date").notNull(),
    endDate: isoDate("end_date"),
    employmentType: text("employment_type").notNull().default("full_time"),
    workdayMinutes: integer("workday_minutes"),
    active: boolean("active").notNull().default(true),
    authUserId: text("auth_user_id").references(() => user.id),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
  },
  (t) => [
    unique("employees_org_id_email_unique").on(t.orgId, t.email),
    uniqueIndex("employees_auth_user_id_unique").on(t.authUserId),
    check("employees_role_check", sql`${t.role} IN ('employee','manager','admin')`),
  ],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamptz("expires_at").notNull(),
  acceptedAt: timestamptz("accepted_at"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => employees.id),
});

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    consumesBalance: boolean("consumes_balance").notNull(),
    unlimited: boolean("unlimited").notNull().default(false),
    legalUnit: text("legal_unit").notNull().default("hours"),
    visibleOnTeamCalendar: boolean("visible_on_team_calendar").notNull().default(true),
    minIncrementMinutes: integer("min_increment_minutes"),
    color: text("color"),
  },
  (t) => [
    unique("leave_types_org_id_code_unique").on(t.orgId, t.code),
    check("leave_types_legal_unit_check", sql`${t.legalUnit} IN ('hours','days')`),
  ],
);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    name: text("name").notNull(),
    period: text("period").notNull().default("calendar_year"),
    grantMode: text("grant_mode").notNull(),
    grantMinutes: integer("grant_minutes"),
    periodicCadence: text("periodic_cadence"),
    periodicMinutes: integer("periodic_minutes"),
    accrualStopMinutes: integer("accrual_stop_minutes"),
    takeCeilingMinutes: integer("take_ceiling_minutes"),
    carryoverMaxMinutes: integer("carryover_max_minutes"),
    allowForfeit: boolean("allow_forfeit").notNull().default(false),
    negativeAllowed: boolean("negative_allowed").notNull().default(false),
    negativeFloorMinutes: integer("negative_floor_minutes"),
    waitingPeriodDays: integer("waiting_period_days").notNull().default(0),
    approvalForRequest: text("approval_for_request").notNull().default("admin"),
    approvalForLog: text("approval_for_log").notNull().default("none"),
    noticeDays: integer("notice_days"),
    minIncrementMinutes: integer("min_increment_minutes").notNull().default(60),
    effectiveFrom: isoDate("effective_from").notNull(),
    effectiveTo: isoDate("effective_to"),
  },
  (t) => [
    check("policies_period_check", sql`${t.period} IN ('calendar_year','anniversary')`),
    check(
      "policies_grant_mode_check",
      sql`${t.grantMode} IN ('lump_sum','periodic','hourly_worked','none')`,
    ),
  ],
);

export const policyTenureBands = pgTable("policy_tenure_bands", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id),
  minYears: integer("min_years").notNull(),
  maxYears: integer("max_years"),
  grantMinutes: integer("grant_minutes").notNull(),
});

export const policyRules = pgTable("policy_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => policies.id),
  code: text("code").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  params: jsonb("params")
    .notNull()
    .default(sql`'{}'::jsonb`),
});

export const policyAssignments = pgTable(
  "policy_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    validFrom: isoDate("valid_from").notNull(),
    validTo: isoDate("valid_to"),
  },
  (t) => [uniqueIndex("policy_assignments_one").on(t.employeeId, t.leaveTypeId)],
);

export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    onDate: isoDate("on_date").notNull(),
    name: text("name").notNull(),
    region: text("region"),
  },
  (t) => [
    uniqueIndex("holidays_org_date_region").on(t.orgId, t.onDate, sql`COALESCE(${t.region}, '')`),
  ],
);

export const blackoutDates = pgTable("blackout_dates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  startDate: isoDate("start_date").notNull(),
  endDate: isoDate("end_date").notNull(),
  name: text("name").notNull(),
});

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  kind: text("kind").notNull(),
  filename: text("filename"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => employees.id),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  reversedAt: timestamptz("reversed_at"),
});

export const leaveEntries = pgTable(
  "leave_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    intent: text("intent").notNull(),
    status: text("status").notNull(),
    immutableAt: timestamptz("immutable_at"),
    startDate: isoDate("start_date").notNull(),
    endDate: isoDate("end_date").notNull(),
    portion: text("portion").notNull(),
    customMinutes: integer("custom_minutes"),
    totalMinutes: integer("total_minutes").notNull(),
    note: text("note"),
    adminNote: text("admin_note"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => employees.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => employees.id),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [
    check("leave_entries_intent_check", sql`${t.intent} IN ('log','request')`),
    check(
      "leave_entries_status_check",
      sql`${t.status} IN ('draft','pending','approved','rejected','cancelled')`,
    ),
    check("leave_entries_portion_check", sql`${t.portion} IN ('full','am','pm','custom')`),
    check("leave_entries_date_range", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

export const leaveDays = pgTable(
  "leave_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaveEntryId: uuid("leave_entry_id")
      .notNull()
      .references(() => leaveEntries.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    onDate: isoDate("on_date").notNull(),
    minutes: integer("minutes").notNull(),
    portion: text("portion").notNull(),
    consumesBalance: boolean("consumes_balance").notNull(),
    slotActive: boolean("slot_active").notNull().default(true),
  },
  (t) => [
    unique("leave_days_leave_entry_id_on_date_unique").on(t.leaveEntryId, t.onDate),
    uniqueIndex("leave_days_consuming_portion")
      .on(t.employeeId, t.onDate, t.portion)
      .where(sql`${t.consumesBalance} = true AND ${t.slotActive} = true`),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    kind: text("kind").notNull(),
    minutes: integer("minutes").notNull(),
    effectiveOn: isoDate("effective_on").notNull(),
    periodYear: integer("period_year").notNull(),
    leaveEntryId: uuid("leave_entry_id").references(() => leaveEntries.id),
    leaveDayId: uuid("leave_day_id").references(() => leaveDays.id),
    reversesId: uuid("reverses_id").references((): AnyPgColumn => ledgerEntries.id),
    reversedAt: timestamptz("reversed_at"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => employees.id),
    createdAt: timestamptz("created_at").notNull(),
  },
  (t) => [
    check(
      "ledger_entries_kind_check",
      sql`${t.kind} IN ('grant_lump','accrual','carryover','usage','adjustment','forfeit','reversal')`,
    ),
    uniqueIndex("ledger_grant_once")
      .on(t.employeeId, t.leaveTypeId, t.kind, t.periodYear, t.effectiveOn)
      .where(sql`${t.kind} IN ('grant_lump','accrual','carryover') AND ${t.reversedAt} IS NULL`),
    uniqueIndex("ledger_import_opening_once")
      .on(t.employeeId, t.leaveTypeId, t.periodYear)
      .where(
        sql`${t.kind} = 'adjustment' AND ${t.reversedAt} IS NULL AND ${t.reason} LIKE 'import: opening remaining%'`,
      ),
    index("ledger_balance_idx").on(t.employeeId, t.leaveTypeId, t.effectiveOn),
  ],
);

export const policyPeriods = pgTable(
  "policy_periods",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    year: integer("year").notNull(),
    status: text("status").notNull(),
    closedAt: timestamptz("closed_at"),
    closedBy: uuid("closed_by").references(() => employees.id),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.year] }),
    check("policy_periods_status_check", sql`${t.status} IN ('future','open','closing','closed')`),
  ],
);

export const yearEndSnapshots = pgTable(
  "year_end_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    year: integer("year").notNull(),
    sha256: text("sha256").notNull(),
    path: text("path").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [unique("year_end_snapshots_org_id_year_unique").on(t.orgId, t.year)],
);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => employees.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  at: timestamptz("at").notNull().defaultNow(),
});

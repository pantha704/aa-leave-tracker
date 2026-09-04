import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  DEMO_DEFAULT_OPERATORS,
  DEMO_MIN_INCREMENT_MINUTES,
  DEMO_ORG_NAME,
  DEMO_SICK_GRANT_MINUTES,
  DEMO_SICK_POLICY_NAME,
  DEMO_SICK_TYPE_CODE,
  DEMO_SICK_TYPE_NAME,
  DEMO_LWOP_TYPE_CODE,
  DEMO_LWOP_TYPE_NAME,
  DEMO_LWOP_POLICY_NAME,
  DEMO_NOTICE_CALENDAR_DAYS,
  DEMO_PTO_CARRYOVER_MINUTES,
  DEMO_VACATION_GRANT_MINUTES,
  DEMO_VACATION_PERIODIC_MINUTES,
  DEMO_VACATION_POLICY_NAME,
  DEMO_VACATION_TAKE_CEILING_MINUTES,
  DEMO_VACATION_TYPE_CODE,
  DEMO_VACATION_TYPE_NAME,
  DEMO_WORKDAY_MINUTES,
} from "./demo-policy";
import { hashPassword } from "better-auth/crypto";
import { account, user } from "./auth-schema";
import {
  employees,
  leaveTypes,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
} from "./schema";
import {
  membershipRoles,
  organizationMemberships,
  organizationRoles,
} from "./schema-membership";
import { ROLE_PERMISSIONS, type RoleKey } from "../server/permissions";
import { getDatabaseUrl } from "../server/db";

type SeedEnv = Partial<Record<string, string | undefined>>;

export function requireSeedTimezone(env: SeedEnv = process.env): string {
  const timezone = env.SEED_TIMEZONE?.trim();
  if (!timezone) {
    throw new Error(
      "SEED_TIMEZONE is required (IANA timezone). Seed refuses to invent a default.",
    );
  }
  return timezone;
}

export function normalizeSeedAdminEmail(raw: string | undefined, fallback: string): string {
  const email = (raw?.trim() || fallback).toLowerCase();
  return email;
}

export type SeedAdmin = { email: string; name: string };

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  if (!local) return email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function resolveSeedAdmins(env: SeedEnv = process.env): SeedAdmin[] {
  const listed = env.SEED_ADMIN_EMAILS?.split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((email) => {
      const normalized = email.toLowerCase();
      const known = DEMO_DEFAULT_OPERATORS.find((op) => op.email === normalized);
      return { email: normalized, name: known?.name ?? nameFromEmail(normalized) };
    });
  if (listed && listed.length > 0) {
    return listed.filter(
      (admin, index) => listed.findIndex((other) => other.email === admin.email) === index,
    );
  }

  const primary = normalizeSeedAdminEmail(env.SEED_ADMIN_EMAIL, DEMO_DEFAULT_OPERATORS[0].email);
  const secondRaw = env.SEED_SECOND_ADMIN_EMAIL?.trim();
  const second = secondRaw
    ? secondRaw.toLowerCase()
    : DEMO_DEFAULT_OPERATORS[1].email;
  const knownPrimary = DEMO_DEFAULT_OPERATORS.find((op) => op.email === primary);
  const knownSecond = DEMO_DEFAULT_OPERATORS.find((op) => op.email === second);
  const admins: SeedAdmin[] = [
    { email: primary, name: knownPrimary?.name ?? nameFromEmail(primary) },
  ];
  if (second !== primary) {
    admins.push({ email: second, name: knownSecond?.name ?? nameFromEmail(second) });
  }
  return admins;
}

export function requireSeedAdminPassword(env: SeedEnv = process.env): string {
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password || password.length === 0) {
    throw new Error("SEED_ADMIN_PASSWORD is required");
  }
  if (password.length < 6) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 6 characters");
  }
  return password;
}

function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function calendarYearInTimeZone(timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(new Date()),
  );
}

export async function seed(env: SeedEnv = process.env): Promise<void> {
  const timezone = requireSeedTimezone(env);
  const adminPassword = requireSeedAdminPassword(env);
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is required to seed");
  }

  const admins = resolveSeedAdmins(env);
  const today = todayInTimeZone(timezone);
  const year = calendarYearInTimeZone(timezone);
  const periodStart = `${year}-01-01`;

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: DEMO_ORG_NAME,
          slug: "absolute-addiction",
          timezone,
          locale: "en",
          standardWorkdayMinutes: DEMO_WORKDAY_MINUTES,
        })
        .returning({ id: organizations.id });

      await tx.insert(orgSettings).values({
        orgId: org.id,
        accrualJobEnabled: true,
        emailEnabled: false,
        appReadonly: false,
        selfLogEnabled: true,
        requestsEnabled: true,
        teamCalendarEnabled: false,
      });

      const roleKeys: RoleKey[] = [
        "employee",
        "manager",
        "hr",
        "hr_admin",
        "executive",
        "org_admin",
        "payroll_viewer",
        "auditor",
      ];
      const createdRoles = await tx
        .insert(organizationRoles)
        .values(
          roleKeys.map((key) => ({
            orgId: org.id,
            key,
            name: key
              .split("_")
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" "),
            permissions: [...ROLE_PERMISSIONS[key]],
          })),
        )
        .returning({ id: organizationRoles.id, key: organizationRoles.key });
      const roleIdByKey = new Map(createdRoles.map((row) => [row.key, row.id]));

      async function insertPerson(opts: {
        email: string;
        name: string;
        role: "admin" | "employee";
        password: string;
      }) {
        const authUserId = crypto.randomUUID();
        const now = new Date();
        await tx.insert(user).values({
          id: authUserId,
          name: opts.name,
          email: opts.email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: authUserId,
          providerId: "credential",
          userId: authUserId,
          password: await hashPassword(opts.password),
          createdAt: now,
          updatedAt: now,
        });
        const [person] = await tx
          .insert(employees)
          .values({
            orgId: org.id,
            email: opts.email,
            name: opts.name,
            role: opts.role,
            startDate: today,
            authUserId,
            mustChangePassword: false,
          })
          .returning({ id: employees.id });
        const [membership] = await tx
          .insert(organizationMemberships)
          .values({
            orgId: org.id,
            employeeId: person.id,
            authUserId,
          })
          .returning({ id: organizationMemberships.id });
        const roleKey: RoleKey = opts.role === "admin" ? "org_admin" : "employee";
        const roleId = roleIdByKey.get(roleKey);
        if (roleId) {
          await tx.insert(membershipRoles).values({
            membershipId: membership.id,
            roleId,
          });
        }
        return person.id;
      }

      const createdTypes = await tx
        .insert(leaveTypes)
        .values([
          {
            orgId: org.id,
            code: DEMO_VACATION_TYPE_CODE,
            name: DEMO_VACATION_TYPE_NAME,
            consumesBalance: true,
            legalUnit: "days",
          },
          {
            orgId: org.id,
            code: DEMO_SICK_TYPE_CODE,
            name: DEMO_SICK_TYPE_NAME,
            consumesBalance: true,
            legalUnit: "days",
          },
          {
            orgId: org.id,
            code: DEMO_LWOP_TYPE_CODE,
            name: DEMO_LWOP_TYPE_NAME,
            consumesBalance: false,
            legalUnit: "days",
          },
        ])
        .returning({ id: leaveTypes.id, code: leaveTypes.code });
      const byCode = new Map(createdTypes.map((row) => [row.code, row.id]));
      const vacationId = byCode.get(DEMO_VACATION_TYPE_CODE)!;
      const sickId = byCode.get(DEMO_SICK_TYPE_CODE)!;
      const lwopId = byCode.get(DEMO_LWOP_TYPE_CODE)!;

      const createdPolicies = await tx
        .insert(policies)
        .values([
          {
            orgId: org.id,
            leaveTypeId: vacationId,
            name: DEMO_VACATION_POLICY_NAME,
            grantMode: "periodic",
            grantMinutes: DEMO_VACATION_GRANT_MINUTES,
            periodicCadence: "monthly",
            periodicMinutes: DEMO_VACATION_PERIODIC_MINUTES,
            takeCeilingMinutes: DEMO_VACATION_TAKE_CEILING_MINUTES,
            carryoverMaxMinutes: DEMO_PTO_CARRYOVER_MINUTES,
            allowForfeit: false,
            approvalForRequest: "admin",
            approvalForLog: "none",
            noticeDays: DEMO_NOTICE_CALENDAR_DAYS,
            minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
            effectiveFrom: periodStart,
          },
          {
            orgId: org.id,
            leaveTypeId: lwopId,
            name: DEMO_LWOP_POLICY_NAME,
            grantMode: "none",
            takeCeilingMinutes: null,
            allowForfeit: false,
            approvalForRequest: "admin",
            approvalForLog: "none",
            minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
            effectiveFrom: periodStart,
          },
          {
            orgId: org.id,
            leaveTypeId: sickId,
            name: DEMO_SICK_POLICY_NAME,
            grantMode: "lump_sum",
            grantMinutes: DEMO_SICK_GRANT_MINUTES,
            takeCeilingMinutes: DEMO_SICK_GRANT_MINUTES,
            allowForfeit: false,
            approvalForRequest: "admin",
            approvalForLog: "none",
            effectiveFrom: periodStart,
          },
        ])
        .returning({ id: policies.id, leaveTypeId: policies.leaveTypeId });

      for (const admin of admins) {
        const employeeId = await insertPerson({
          email: admin.email,
          name: admin.name,
          role: "admin",
          password: adminPassword,
        });
        await tx.insert(policyAssignments).values(
          createdPolicies.map((policy) => ({
            employeeId,
            policyId: policy.id,
            leaveTypeId: policy.leaveTypeId,
            validFrom: periodStart,
          })),
        );
      }

      await tx.insert(policyPeriods).values([
        {
          orgId: org.id,
          year,
          status: "open",
        },
        {
          orgId: org.id,
          year: year + 1,
          status: "future",
        },
      ]);
    });

    console.log(`DEMO standard_workday_minutes=${DEMO_WORKDAY_MINUTES} (8.00h)`);
    console.log(
      `Seeded org "${DEMO_ORG_NAME}" timezone=${timezone} year=${year} (open) year=${year + 1} (future)`,
    );
    console.log(`Assigned vacation + sick policies to ${admins.length} admin(s).`);
    console.log(`Seeded admins ${admins.map((a) => a.email).join(", ")}`);
    console.log("No holiday rows seeded.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

function isExecutedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

if (isExecutedAsScript()) {
  seed().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

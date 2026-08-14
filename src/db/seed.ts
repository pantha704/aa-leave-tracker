import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  DEMO_DEFAULT_ADMIN_EMAIL,
  DEMO_MIN_INCREMENT_MINUTES,
  DEMO_ORG_NAME,
  DEMO_SICK_GRANT_MINUTES,
  DEMO_SICK_POLICY_NAME,
  DEMO_SICK_TYPE_CODE,
  DEMO_SICK_TYPE_NAME,
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
import { employees, leaveTypes, organizations, orgSettings, policies, policyPeriods } from "./schema";
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

export function requireSeedAdminPassword(env: SeedEnv = process.env): string {
  const password = env.SEED_ADMIN_PASSWORD;
  if (!password || password.length === 0) {
    throw new Error("SEED_ADMIN_PASSWORD is required");
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters");
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

  const adminEmail = normalizeSeedAdminEmail(env.SEED_ADMIN_EMAIL, DEMO_DEFAULT_ADMIN_EMAIL);
  const passwordHash = await hashPassword(adminPassword);
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
          timezone,
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

      const [vacationType, sickType] = await tx
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
        ])
        .returning({ id: leaveTypes.id, code: leaveTypes.code });

      const vacationId = vacationType.code === DEMO_VACATION_TYPE_CODE ? vacationType.id : sickType.id;
      const sickId = sickType.code === DEMO_SICK_TYPE_CODE ? sickType.id : vacationType.id;

      await tx.insert(policies).values([
        {
          orgId: org.id,
          leaveTypeId: vacationId,
          name: DEMO_VACATION_POLICY_NAME,
          grantMode: "periodic",
          grantMinutes: DEMO_VACATION_GRANT_MINUTES,
          periodicCadence: "monthly",
          periodicMinutes: DEMO_VACATION_PERIODIC_MINUTES,
          takeCeilingMinutes: DEMO_VACATION_TAKE_CEILING_MINUTES,
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
      ]);

      const authUserId = crypto.randomUUID();
      const now = new Date();
      await tx.insert(user).values({
        id: authUserId,
        name: "Admin",
        email: adminEmail,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: authUserId,
        providerId: "credential",
        userId: authUserId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(employees).values({
        orgId: org.id,
        email: adminEmail,
        name: "Admin",
        role: "admin",
        startDate: today,
        authUserId,
        mustChangePassword: true,
      });

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
    console.log("Assign policies, then first-year open the same year to grant Sick.");
    console.log(`Seeded admin ${adminEmail} (must change password on first login)`);
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

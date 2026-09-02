import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DEMO_MIN_INCREMENT_MINUTES, DEMO_WORKDAY_MINUTES } from "@/db/demo-policy";
import {
  employees,
  leaveDays,
  leaveTypes,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
} from "@/db/schema";
import { getDatabaseUrl, pingDatabase } from "@/server/db";
import { postLedgerEntry } from "@/server/ledger/post";
import { decideLeave } from "./decide";
import { runWithLeaveDb, submitLeave } from "./submit";

const url = getDatabaseUrl();
const MON = "2026-07-06";
const TODAY = "2026-06-15";

describe.skipIf(!url)("leave submit against Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let adminId: string;
  let employeeId: string;
  let leaveTypeId: string;

  beforeAll(async () => {
    if (!url) return;
    const up = await pingDatabase(url);
    if (!up) {
      throw new Error("DATABASE_URL is set but Postgres is not reachable");
    }
    sql = postgres(url, { max: 8, connect_timeout: 8 });
    db = drizzle(sql);
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS citext");
    for (const file of ["0000_fancy_anita_blake.sql", "0001_dapper_chat.sql"]) {
      const migration = readFileSync(path.join(process.cwd(), "src/db/migrations", file), "utf8");
      for (const statement of migration.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length === 0) continue;
        try {
          await sql.unsafe(trimmed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/already exists/i.test(message)) throw err;
        }
      }
    }

    const [org] = await db
      .insert(organizations)
      .values({
        name: `leave-test-${crypto.randomUUID()}`,
        slug: `leave-test-${crypto.randomUUID()}`,
        timezone: "UTC",
        standardWorkdayMinutes: DEMO_WORKDAY_MINUTES,
      })
      .returning();
    await db.insert(orgSettings).values({ orgId: org.id });
    const [admin] = await db
      .insert(employees)
      .values({
        orgId: org.id,
        email: `admin-${crypto.randomUUID()}@example.test`,
        name: "Admin",
        role: "admin",
        startDate: "2020-01-01",
      })
      .returning();
    const [emp] = await db
      .insert(employees)
      .values({
        orgId: org.id,
        email: `emp-${crypto.randomUUID()}@example.test`,
        name: "Alice",
        role: "employee",
        startDate: "2020-01-01",
      })
      .returning();
    const [type] = await db
      .insert(leaveTypes)
      .values({
        orgId: org.id,
        code: `vac-${crypto.randomUUID().slice(0, 8)}`,
        name: "Vacation",
        consumesBalance: true,
      })
      .returning();
    const [policy] = await db
      .insert(policies)
      .values({
        orgId: org.id,
        leaveTypeId: type.id,
        name: "Vacation",
        grantMode: "lump_sum",
        grantMinutes: 20_000,
        approvalForRequest: "admin",
        approvalForLog: "none",
        minIncrementMinutes: DEMO_MIN_INCREMENT_MINUTES,
        negativeAllowed: true,
        effectiveFrom: "2026-01-01",
      })
      .returning();
    await db.insert(policyAssignments).values({
      employeeId: emp.id,
      policyId: policy.id,
      leaveTypeId: type.id,
      validFrom: "2026-01-01",
    });
    await db.insert(policyPeriods).values({
      orgId: org.id,
      year: 2026,
      status: "open",
    });
    await postLedgerEntry(db, {
      employeeId: emp.id,
      leaveTypeId: type.id,
      kind: "grant_lump",
      minutes: 20_000,
      effectiveOn: "2026-01-01",
      createdBy: admin.id,
    });
    adminId = admin.id;
    employeeId = emp.id;
    leaveTypeId = type.id;
  }, 30_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("fixture (d): cancel pending Monday then resubmit against the consuming unique index", async () => {
    await runWithLeaveDb(db, async () => {
      const first = await submitLeave(
        {
          actor: { id: employeeId, role: "employee" },
          employeeId,
          leaveTypeId,
          startDate: MON,
          endDate: MON,
          portion: "full",
        },
        { today: TODAY, writeAudit: async () => undefined, notify: async () => undefined },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const cancelled = await decideLeave(
        { actor: { id: employeeId, role: "employee" }, entryId: first.entry.id, action: "cancel" },
        { today: TODAY, writeAudit: async () => undefined },
      );
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;

      const firstDays = await db
        .select()
        .from(leaveDays)
        .where(eq(leaveDays.leaveEntryId, first.entry.id));
      expect(firstDays.every((day) => day.slotActive === false)).toBe(true);

      const second = await submitLeave(
        {
          actor: { id: employeeId, role: "employee" },
          employeeId,
          leaveTypeId,
          startDate: MON,
          endDate: MON,
          portion: "full",
        },
        { today: TODAY, writeAudit: async () => undefined, notify: async () => undefined },
      );
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.entry.id).not.toBe(first.entry.id);

      const active = await db
        .select()
        .from(leaveDays)
        .where(and(eq(leaveDays.employeeId, employeeId), eq(leaveDays.onDate, MON)));
      expect(active.filter((day) => day.slotActive)).toHaveLength(1);
      expect(active.filter((day) => !day.slotActive)).toHaveLength(1);
      void adminId;
    });
  });
});

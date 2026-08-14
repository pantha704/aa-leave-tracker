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
  leaveEntries,
  leaveTypes,
  ledgerEntries,
  organizations,
  orgSettings,
  policies,
  policyAssignments,
  policyPeriods,
} from "@/db/schema";
import { getDatabaseUrl, pingDatabase } from "@/server/db";
import { postLedgerEntry } from "@/server/ledger/post";
import { decideLeave } from "@/server/leave/decide";
import { runWithLeaveDb, submitLeave } from "@/server/leave/submit";
import { pgTerminateStore, terminateEmployee } from "./terminate";

const url = getDatabaseUrl();
const TODAY = "2026-06-15";
const END = "2026-06-30";

describe.skipIf(!url)("terminate against Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let orgId: string;
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
        name: `term-test-${crypto.randomUUID()}`,
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
    orgId = org.id;
    adminId = admin.id;
    employeeId = emp.id;
    leaveTypeId = type.id;
  }, 30_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("reverses later usage on a mixed approved span and trims the entry", async () => {
    const submitted = await runWithLeaveDb(db, async () => {
      const first = await submitLeave(
        {
          actor: { id: employeeId, role: "employee" },
          employeeId,
          leaveTypeId,
          startDate: "2026-06-29",
          endDate: "2026-07-01",
          portion: "full",
        },
        { today: TODAY, writeAudit: async () => undefined },
      );
      expect(first.ok).toBe(true);
      if (!first.ok) return first;
      const decided = await decideLeave(
        { actor: { id: adminId, role: "admin" }, entryId: first.entry.id, action: "approve" },
        { today: TODAY, writeAudit: async () => undefined },
      );
      expect(decided.ok).toBe(true);
      return first;
    });
    expect(submitted?.ok).toBe(true);
    if (!submitted?.ok) return;

    const result = await terminateEmployee({
      actor: { id: adminId, role: "admin" },
      orgId,
      employeeId,
      raw: { endDate: END, reason: "last day" },
      store: pgTerminateStore(db),
      writeAudit: async () => undefined,
      buildExport: async () => ({
        ok: true,
        csv: "email,leave_type,end_date,ledger_remaining,pro_rata_earned_to_end_date\n",
        filename: `termination-${END}.csv`,
        rowCount: 0,
        kind: "termination",
      }),
      now: new Date("2026-06-30T12:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [entry] = await db
      .select()
      .from(leaveEntries)
      .where(eq(leaveEntries.id, submitted.entry.id));
    expect(entry?.status).toBe("approved");
    expect(entry?.endDate).toBe(END);
    expect(entry?.endDate <= END).toBe(true);
    expect(entry?.totalMinutes).toBe(DEMO_WORKDAY_MINUTES * 2);

    const days = await db
      .select()
      .from(leaveDays)
      .where(eq(leaveDays.leaveEntryId, submitted.entry.id));
    expect(days.filter((day) => day.onDate <= END).every((day) => day.slotActive)).toBe(true);
    expect(days.filter((day) => day.onDate > END).every((day) => !day.slotActive)).toBe(true);

    const usage = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.leaveEntryId, submitted.entry.id), eq(ledgerEntries.kind, "usage")),
      );
    const later = usage.filter((row) => row.effectiveOn > END);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((row) => row.reversedAt != null)).toBe(true);
    expect(usage.filter((row) => row.effectiveOn <= END).every((row) => row.reversedAt == null)).toBe(
      true,
    );
    const reversals = await db
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.leaveEntryId, submitted.entry.id), eq(ledgerEntries.kind, "reversal")),
      );
    expect(reversals).toHaveLength(later.length);
  });
});

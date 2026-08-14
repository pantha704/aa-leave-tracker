import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { DEMO_WORKDAY_MINUTES } from "@/db/demo-policy";
import { employees, leaveTypes, ledgerEntries, organizations } from "@/db/schema";
import { getDatabaseUrl, pingDatabase } from "@/server/db";
import { getBalance } from "./balance";
import { postLedgerEntry, reverseLedgerEntry } from "./post";

const url = getDatabaseUrl();

describe.skipIf(!url)("ledger against Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let actorId: string;
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
    const migration = readFileSync(
      path.join(process.cwd(), "src/db/migrations/0000_fancy_anita_blake.sql"),
      "utf8",
    );
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

    const [org] = await db
      .insert(organizations)
      .values({
        name: `ledger-test-${crypto.randomUUID()}`,
        timezone: "UTC",
        standardWorkdayMinutes: DEMO_WORKDAY_MINUTES,
      })
      .returning();
    const [actor] = await db
      .insert(employees)
      .values({
        orgId: org.id,
        email: `admin-${crypto.randomUUID()}@example.test`,
        name: "Admin",
        role: "admin",
        startDate: "2026-01-01",
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
    actorId = actor.id;
    employeeId = actor.id;
    leaveTypeId = type.id;
  }, 30_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("posts usage under the advisory lock and SUMs remaining", async () => {
    await postLedgerEntry(db, {
      employeeId,
      leaveTypeId,
      kind: "accrual",
      minutes: 680,
      effectiveOn: "2026-01-01",
      createdBy: actorId,
    });
    await postLedgerEntry(db, {
      employeeId,
      leaveTypeId,
      kind: "usage",
      minutes: 480,
      effectiveOn: "2026-07-06",
      createdBy: actorId,
    });

    const march = await getBalance(db, {
      employeeId,
      leaveTypeId,
      asOf: "2026-03-15",
      timeZone: "UTC",
    });
    expect(march.grantedMinutes).toBe(680);
    expect(march.takenMinutes).toBe(0);
    expect(march.scheduledMinutes).toBe(480);
    expect(march.remainingMinutes).toBe(200);

    const july = await getBalance(db, {
      employeeId,
      leaveTypeId,
      asOf: "2026-07-06",
      timeZone: "UTC",
    });
    expect(july.takenMinutes).toBe(480);
    expect(july.remainingMinutes).toBe(200);
  });

  it("reverses in one transaction then allows a new live grant", async () => {
    const grant = await postLedgerEntry(db, {
      employeeId,
      leaveTypeId,
      kind: "grant_lump",
      minutes: 1440,
      effectiveOn: "2026-01-01",
      createdBy: actorId,
    });
    const { original, reversal } = await reverseLedgerEntry(db, {
      id: grant.id,
      createdBy: actorId,
      reason: "reopen",
    });
    expect(original.reversedAt).toBeInstanceOf(Date);
    expect(reversal.kind).toBe("reversal");
    expect(reversal.minutes).toBe(-grant.minutes);

    const again = await postLedgerEntry(db, {
      employeeId,
      leaveTypeId,
      kind: "grant_lump",
      minutes: 1440,
      effectiveOn: "2026-01-01",
      createdBy: actorId,
    });
    expect(again.reversedAt).toBeNull();

    const live = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.employeeId, employeeId));
    expect(live.filter((row) => row.kind === "grant_lump" && row.reversedAt == null)).toHaveLength(1);
  });

  it("lets two concurrent first posts both insert", async () => {
    const other = crypto.randomUUID();
    const [emp] = await db
      .insert(employees)
      .values({
        orgId: (
          await db.select({ orgId: employees.orgId }).from(employees).where(eq(employees.id, employeeId))
        )[0].orgId,
        email: `emp-${other}@example.test`,
        name: "New hire",
        role: "employee",
        startDate: "2026-01-01",
      })
      .returning();

    const [a, b] = await Promise.all([
      postLedgerEntry(db, {
        employeeId: emp.id,
        leaveTypeId,
        kind: "adjustment",
        minutes: 60,
        effectiveOn: "2026-01-01",
        createdBy: actorId,
        reason: "first-a",
      }),
      postLedgerEntry(db, {
        employeeId: emp.id,
        leaveTypeId,
        kind: "adjustment",
        minutes: 90,
        effectiveOn: "2026-01-01",
        createdBy: actorId,
        reason: "first-b",
      }),
    ]);

    expect(a.id).not.toBe(b.id);
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.employeeId, emp.id));
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.minutes, 0)).toBe(150);
  });
});

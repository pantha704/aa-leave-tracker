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
import { postLedgerEntry, postLedgerEntryInTx, reverseLedgerEntry, withEmployeeLock } from "./post";

const url = getDatabaseUrl();

describe.skipIf(!url)("ledger against Postgres", () => {
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let actorId: string;
  let employeeId: string;
  let leaveTypeId: string;
  const statements: string[] = [];

  beforeAll(async () => {
    if (!url) return;
    const up = await pingDatabase(url);
    if (!up) {
      throw new Error("DATABASE_URL is set but Postgres is not reachable");
    }
    sql = postgres(url, {
      max: 8,
      connect_timeout: 8,
      debug: (_connection, query) => {
        statements.push(query);
      },
    });
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
        timezone: "America/Los_Angeles",
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
    statements.length = 0;
    await postLedgerEntry(db, {
      employeeId,
      leaveTypeId,
      kind: "accrual",
      minutes: 680,
      effectiveOn: "2026-01-01",
      createdBy: actorId,
    });
    const captured = statements.join("\n");
    const beginAt = captured.search(/\bbegin\b/i);
    const lockAt = captured.search(/pg_advisory_xact_lock/i);
    const insertAt = captured.search(/insert\s+into\s+"?ledger_entries"?/i);
    expect(beginAt).toBeGreaterThanOrEqual(0);
    expect(lockAt).toBeGreaterThan(beginAt);
    expect(insertAt).toBeGreaterThan(lockAt);

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
      timeZone: "America/Los_Angeles",
    });
    expect(march.asOf).toBe("2026-03-15");
    expect(march.grantedMinutes).toBe(680);
    expect(march.takenMinutes).toBe(0);
    expect(march.scheduledMinutes).toBe(480);
    expect(march.remainingMinutes).toBe(200);

    const again = await getBalance(db, {
      employeeId,
      leaveTypeId,
      asOf: march.asOf,
      timeZone: "America/Los_Angeles",
    });
    expect(again.remainingMinutes).toBe(200);

    const july = await getBalance(db, {
      employeeId,
      leaveTypeId,
      asOf: "2026-07-06",
      timeZone: "America/Los_Angeles",
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

  it("serializes two grant-once posts: one insert, one unique violation", async () => {
    const [emp] = await db
      .insert(employees)
      .values({
        orgId: (
          await db.select({ orgId: employees.orgId }).from(employees).where(eq(employees.id, employeeId))
        )[0].orgId,
        email: `grant-${crypto.randomUUID()}@example.test`,
        name: "Grant race",
        role: "employee",
        startDate: "2026-01-01",
      })
      .returning();

    const input = {
      employeeId: emp.id,
      leaveTypeId,
      kind: "accrual" as const,
      minutes: 680,
      effectiveOn: "2028-01-01",
      createdBy: actorId,
    };
    const results = await Promise.allSettled([postLedgerEntry(db, input), postLedgerEntry(db, input)]);
    const ok = results.filter((result) => result.status === "fulfilled");
    const failed = results.filter((result) => result.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.employeeId, emp.id));
    expect(rows.filter((row) => row.kind === "accrual" && row.reversedAt == null)).toHaveLength(1);
  });

  it("posts two rows on one locked transaction via postLedgerEntryInTx", async () => {
    const [emp] = await db
      .insert(employees)
      .values({
        orgId: (
          await db.select({ orgId: employees.orgId }).from(employees).where(eq(employees.id, employeeId))
        )[0].orgId,
        email: `lock-${crypto.randomUUID()}@example.test`,
        name: "Locked multi",
        role: "employee",
        startDate: "2026-01-01",
      })
      .returning();

    await withEmployeeLock(db, emp.id, async (tx) => {
      await postLedgerEntryInTx(tx, {
        employeeId: emp.id,
        leaveTypeId,
        kind: "accrual",
        minutes: 680,
        effectiveOn: "2026-02-01",
        createdBy: actorId,
      });
      await postLedgerEntryInTx(tx, {
        employeeId: emp.id,
        leaveTypeId,
        kind: "adjustment",
        minutes: 60,
        effectiveOn: "2026-02-01",
        createdBy: actorId,
        reason: "same-tx",
      });
    });

    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.employeeId, emp.id));
    expect(rows).toHaveLength(2);
  });
});

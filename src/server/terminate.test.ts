import { describe, expect, it } from "vitest";
import { TERMINATION_CSV_HEADERS, TERMINATION_HOUR_COLUMNS } from "@/server/export/termination";
import type { AuditEventInput } from "@/server/audit";
import type { EmployeeIdentity } from "@/server/admin/employees";
import {
  entryHasDayAfter,
  parseTerminateInput,
  shouldSkipGrantOrAccrual,
  terminateEmployee,
  terminationCsvDownloadPath,
  type TerminateStore,
  type TerminateStoreEntry,
} from "./terminate";

const PERSON = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";
const DAY = 480;

function identity(overrides: Partial<EmployeeIdentity> = {}): EmployeeIdentity {
  return {
    id: PERSON,
    orgId: "org-1",
    name: "Ada",
    email: "ada@example.com",
    role: "employee",
    managerId: null,
    startDate: "2026-01-15",
    endDate: null,
    employmentType: "full_time",
    workdayMinutes: DAY,
    orgWorkdayMinutes: DAY,
    timezone: "UTC",
    active: true,
    ...overrides,
  };
}

function entry(overrides: Partial<TerminateStoreEntry> & { id: string }): TerminateStoreEntry {
  const days = overrides.days ?? [{ onDate: "2026-07-06", slotActive: true, minutes: DAY }];
  const startDate = overrides.startDate ?? days[0]?.onDate ?? "2026-07-06";
  const endDate = overrides.endDate ?? days[days.length - 1]?.onDate ?? startDate;
  return {
    status: "pending",
    startDate,
    endDate,
    totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
    immutableAt: null,
    ...overrides,
    days,
  };
}

function memoryStore(
  start: { employee?: EmployeeIdentity; entries?: TerminateStoreEntry[] } = {},
): TerminateStore & {
  employee: EmployeeIdentity;
  entries: TerminateStoreEntry[];
  reversed: string[];
  cancelled: string[];
} {
  const state = {
    employee: start.employee ?? identity(),
    entries: start.entries ?? [],
    reversed: [] as string[],
    cancelled: [] as string[],
    usage: (start.entries ?? [])
      .filter((row) => row.status === "approved")
      .flatMap((row) =>
        row.days.map((day) => ({
          leaveEntryId: row.id,
          effectiveOn: day.onDate,
          reversed: false,
        })),
      ),
  };
  return {
    get employee() {
      return state.employee;
    },
    get entries() {
      return state.entries;
    },
    get reversed() {
      return state.reversed;
    },
    get cancelled() {
      return state.cancelled;
    },
    async withEmployeeLock(_employeeId, fn) {
      return fn();
    },
    async getEmployee(orgId, employeeId) {
      if (orgId !== state.employee.orgId || employeeId !== state.employee.id) return null;
      return { ...state.employee };
    },
    async markInactive(_employeeId, endDate) {
      state.employee = { ...state.employee, endDate, active: false };
    },
    async listEntries() {
      return state.entries.map((row) => ({ ...row, days: row.days.map((day) => ({ ...day })) }));
    },
    async cancelEntry(input) {
      state.cancelled.push(input.id);
      const found = state.entries.find((row) => row.id === input.id);
      if (found) {
        found.status = "cancelled";
        found.days = found.days.map((day) => ({ ...day, slotActive: false }));
      }
    },
    async deactivateDaysAfter(leaveEntryId, endDate) {
      const found = state.entries.find((row) => row.id === leaveEntryId);
      if (!found) return;
      found.days = found.days.map((day) =>
        day.onDate > endDate ? { ...day, slotActive: false } : day,
      );
    },
    async trimEntryTo(input) {
      const found = state.entries.find((row) => row.id === input.id);
      if (!found) return;
      found.endDate = input.endDate;
      found.totalMinutes = input.totalMinutes;
    },
    async reverseUsageAfter(input) {
      let n = 0;
      for (const row of state.usage) {
        if (row.leaveEntryId !== input.leaveEntryId || row.reversed) continue;
        if (row.effectiveOn <= input.endDate) continue;
        row.reversed = true;
        n += 1;
      }
      if (n > 0) state.reversed.push(input.leaveEntryId);
      return n;
    },
    async lockRemainingEntries(_employeeId, at) {
      let n = 0;
      for (const row of state.entries) {
        if (row.immutableAt == null) {
          row.immutableAt = at;
          n += 1;
        }
      }
      return n;
    },
  };
}

const csv =
  "email,leave_type,end_date,ledger_remaining,pro_rata_earned_to_end_date\nada@example.com,vacation,2026-06-30,24.00,12.00\n";

function buildOk() {
  return async (input: { kind: string; employeeId?: string; endDate?: string }) => {
    expect(input).toMatchObject({ kind: "termination", employeeId: PERSON, endDate: "2026-06-30" });
    return {
      ok: true as const,
      csv,
      filename: "termination-2026-06-30.csv",
      rowCount: 1,
      kind: "termination" as const,
    };
  };
}

describe("parseTerminateInput", () => {
  it("requires a calendar date and a reason", () => {
    expect(parseTerminateInput({ endDate: "2026-06-30", reason: "  " })).toEqual({
      ok: false,
      error: "reason is required",
    });
    expect(parseTerminateInput({ endDate: "2026-02-31", reason: "left" })).toEqual({
      ok: false,
      error: "endDate must be YYYY-MM-DD",
    });
    expect(parseTerminateInput({ end_date: "2026-06-30", reason: "left" })).toEqual({
      ok: true,
      value: { endDate: "2026-06-30", reason: "left" },
    });
  });
});

describe("shouldSkipGrantOrAccrual", () => {
  it("skips after end_date, not last-day grants for an inactive employee", () => {
    expect(shouldSkipGrantOrAccrual({ active: true, endDate: null }, "2026-07-01")).toBe(false);
    expect(shouldSkipGrantOrAccrual({ active: false, endDate: null }, "2026-06-01")).toBe(true);
    expect(shouldSkipGrantOrAccrual({ active: false, endDate: "2026-06-01" }, "2026-06-01")).toBe(
      false,
    );
    expect(shouldSkipGrantOrAccrual({ active: false, endDate: "2026-06-30" }, "2026-06-01")).toBe(
      false,
    );
    expect(shouldSkipGrantOrAccrual({ active: true, endDate: "2026-06-30" }, "2026-06-30")).toBe(
      false,
    );
    expect(shouldSkipGrantOrAccrual({ active: true, endDate: "2026-06-30" }, "2026-07-01")).toBe(
      true,
    );
  });
});

describe("terminateEmployee", () => {
  it("sets end_date and active=false, cancels future pending, reverses approved-future", async () => {
    const store = memoryStore({
      entries: [
        entry({ id: "pend-future", status: "pending" }),
        entry({
          id: "draft-future",
          status: "draft",
          startDate: "2026-07-10",
          endDate: "2026-07-10",
          days: [{ onDate: "2026-07-10", slotActive: true, minutes: DAY }],
        }),
        entry({
          id: "pend-past",
          status: "pending",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          days: [{ onDate: "2026-06-01", slotActive: true, minutes: DAY }],
        }),
        entry({
          id: "pend-mixed",
          status: "pending",
          startDate: "2026-06-29",
          endDate: "2026-07-01",
          days: [
            { onDate: "2026-06-29", slotActive: true, minutes: DAY },
            { onDate: "2026-06-30", slotActive: true, minutes: DAY },
            { onDate: "2026-07-01", slotActive: true, minutes: DAY },
          ],
        }),
        entry({
          id: "appr-future",
          status: "approved",
          startDate: "2026-07-06",
          endDate: "2026-07-08",
          days: [
            { onDate: "2026-07-06", slotActive: true, minutes: DAY },
            { onDate: "2026-07-07", slotActive: true, minutes: DAY },
            { onDate: "2026-07-08", slotActive: true, minutes: DAY },
          ],
        }),
        entry({
          id: "appr-mixed",
          status: "approved",
          startDate: "2026-06-29",
          endDate: "2026-07-01",
          days: [
            { onDate: "2026-06-29", slotActive: true, minutes: DAY },
            { onDate: "2026-06-30", slotActive: true, minutes: DAY },
            { onDate: "2026-07-01", slotActive: true, minutes: DAY },
          ],
        }),
      ],
    });
    const events: AuditEventInput[] = [];
    const result = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "last day" },
      store,
      writeAudit: async (event) => {
        events.push(event);
      },
      buildExport: buildOk(),
      now: new Date("2026-06-30T12:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.employee).toMatchObject({ active: false, endDate: "2026-06-30" });
    expect(store.cancelled).toEqual(["pend-future", "draft-future", "appr-future"]);
    expect(store.reversed).toEqual(["appr-future", "appr-mixed"]);
    expect(result.cancelledEntries).toBe(3);
    expect(result.reversedUsage).toBe(4);
    expect(store.entries.find((row) => row.id === "pend-past")?.status).toBe("pending");
    const mixedPending = store.entries.find((row) => row.id === "pend-mixed");
    expect(mixedPending).toMatchObject({
      status: "pending",
      endDate: "2026-06-30",
      totalMinutes: DAY * 2,
    });
    const mixed = store.entries.find((row) => row.id === "appr-mixed");
    expect(mixed).toMatchObject({
      status: "approved",
      endDate: "2026-06-30",
      totalMinutes: DAY * 2,
    });
    expect(mixed?.days).toEqual([
      { onDate: "2026-06-29", slotActive: true, minutes: DAY },
      { onDate: "2026-06-30", slotActive: true, minutes: DAY },
      { onDate: "2026-07-01", slotActive: false, minutes: DAY },
    ]);
    expect(store.entries.every((row) => row.immutableAt != null)).toBe(true);
    expect(result.downloadPath).toBe(terminationCsvDownloadPath(PERSON, "2026-06-30"));
    expect(result.csv.split("\n")[0]?.split(",")).toEqual([...TERMINATION_CSV_HEADERS]);
    expect(TERMINATION_HOUR_COLUMNS.every((col) => result.csv.includes(col))).toBe(true);
    expect(result.exportError).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        action: "employee.terminate",
        entityType: "employee",
        entityId: PERSON,
        after: expect.objectContaining({ endDate: "2026-06-30", active: false, reason: "last day" }),
      }),
    ]);
  });

  it("re-exports when the employee is already inactive", async () => {
    const store = memoryStore({ employee: identity({ active: false, endDate: "2026-06-30" }) });
    const result = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "again" },
      store,
      writeAudit: async () => undefined,
      buildExport: buildOk(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alreadyInactive).toBe(true);
    expect(result.csv).toContain("ledger_remaining");
    expect(store.employee.endDate).toBe("2026-06-30");
  });

  it("returns 200 with downloadPath when export throws after commit", async () => {
    const store = memoryStore();
    const result = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "left" },
      store,
      writeAudit: async () => undefined,
      buildExport: async () => {
        throw new Error("csv unavailable");
      },
      now: new Date("2026-06-30T12:00:00Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.employee.active).toBe(false);
    expect(result.csv).toBe("");
    expect(result.exportError).toBe("csv unavailable");
    expect(result.downloadPath).toBe(terminationCsvDownloadPath(PERSON, "2026-06-30"));
  });

  it("rejects endDate before startDate and after today", async () => {
    const store = memoryStore();
    const beforeStart = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-01-01", reason: "early" },
      store,
      writeAudit: async () => undefined,
      buildExport: buildOk(),
      now: new Date("2026-06-30T12:00:00Z"),
    });
    expect(beforeStart).toEqual({
      ok: false,
      status: 400,
      error: "endDate must be on or after startDate",
    });

    const future = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-07-15", reason: "notice" },
      store,
      writeAudit: async () => undefined,
      now: new Date("2026-06-30T12:00:00Z"),
    });
    expect(future).toEqual({ ok: false, status: 400, error: "endDate cannot be after today" });
  });

  it("forbids a non-admin", async () => {
    const result = await terminateEmployee({
      actor: { id: PERSON, role: "employee" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "no" },
      store: memoryStore(),
      writeAudit: async () => {
        throw new Error("must not audit");
      },
    });
    expect(result).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("returns 401 when unauthenticated", async () => {
    const result = await terminateEmployee({
      actor: null,
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "no" },
    });
    expect(result).toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });
});

describe("entryHasDayAfter", () => {
  it("is false when the last day is the end date", () => {
    expect(entryHasDayAfter({ days: [{ onDate: "2026-06-30" }] }, "2026-06-30")).toBe(false);
    expect(entryHasDayAfter({ days: [{ onDate: "2026-07-01" }] }, "2026-06-30")).toBe(true);
  });
});

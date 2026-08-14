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
    workdayMinutes: 480,
    orgWorkdayMinutes: 480,
    timezone: "UTC",
    active: true,
    ...overrides,
  };
}

function entry(overrides: Partial<TerminateStoreEntry> & { id: string }): TerminateStoreEntry {
  return {
    status: "pending",
    startDate: "2026-07-06",
    endDate: "2026-07-06",
    immutableAt: null,
    days: [{ onDate: "2026-07-06", slotActive: true }],
    ...overrides,
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
    async reverseUsageAfter(input) {
      const found = state.entries.find((row) => row.id === input.leaveEntryId);
      if (!found) return 0;
      const count = found.days.filter((day) => day.onDate > input.endDate).length;
      state.reversed.push(input.leaveEntryId);
      return count;
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
  return async () =>
    ({
      ok: true as const,
      csv,
      filename: "termination-2026-06-30.csv",
      rowCount: 1,
      kind: "termination" as const,
    });
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
  it("skips inactive employees and posts after end_date", () => {
    expect(shouldSkipGrantOrAccrual({ active: true, endDate: null }, "2026-07-01")).toBe(false);
    expect(shouldSkipGrantOrAccrual({ active: false, endDate: "2026-06-30" }, "2026-06-01")).toBe(
      true,
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
        entry({ id: "pend-future", status: "pending", startDate: "2026-07-06", endDate: "2026-07-06" }),
        entry({
          id: "pend-past",
          status: "pending",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          days: [{ onDate: "2026-06-01", slotActive: true }],
        }),
        entry({
          id: "appr-future",
          status: "approved",
          startDate: "2026-07-06",
          endDate: "2026-07-08",
          days: [
            { onDate: "2026-07-06", slotActive: true },
            { onDate: "2026-07-07", slotActive: true },
            { onDate: "2026-07-08", slotActive: true },
          ],
        }),
        entry({
          id: "appr-mixed",
          status: "approved",
          startDate: "2026-06-29",
          endDate: "2026-07-01",
          days: [
            { onDate: "2026-06-29", slotActive: true },
            { onDate: "2026-06-30", slotActive: true },
            { onDate: "2026-07-01", slotActive: true },
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(store.employee).toMatchObject({ active: false, endDate: "2026-06-30" });
    expect(store.cancelled).toEqual(["pend-future", "appr-future"]);
    expect(store.reversed).toEqual(["appr-future", "appr-mixed"]);
    expect(result.cancelledPending).toBe(1);
    expect(result.reversedUsage).toBe(4);
    expect(store.entries.find((row) => row.id === "pend-past")?.status).toBe("pending");
    expect(store.entries.find((row) => row.id === "appr-mixed")?.status).toBe("approved");
    expect(store.entries.find((row) => row.id === "appr-mixed")?.days).toEqual([
      { onDate: "2026-06-29", slotActive: true },
      { onDate: "2026-06-30", slotActive: true },
      { onDate: "2026-07-01", slotActive: false },
    ]);
    expect(store.entries.every((row) => row.immutableAt != null)).toBe(true);
    expect(result.downloadPath).toBe(terminationCsvDownloadPath(PERSON, "2026-06-30"));
    expect(result.csv.split("\n")[0]?.split(",")).toEqual([...TERMINATION_CSV_HEADERS]);
    expect(TERMINATION_HOUR_COLUMNS.every((col) => result.csv.includes(col))).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        action: "employee.terminate",
        entityType: "employee",
        entityId: PERSON,
        after: expect.objectContaining({ endDate: "2026-06-30", active: false, reason: "last day" }),
      }),
    ]);
  });

  it("refuses a second terminate", async () => {
    const store = memoryStore({ employee: identity({ active: false, endDate: "2026-05-01" }) });
    const result = await terminateEmployee({
      actor: { id: ADMIN, role: "admin" },
      orgId: "org-1",
      employeeId: PERSON,
      raw: { endDate: "2026-06-30", reason: "again" },
      store,
      writeAudit: async () => undefined,
      buildExport: buildOk(),
    });
    expect(result).toEqual({ ok: false, status: 409, error: "employee is already inactive" });
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
});

describe("entryHasDayAfter", () => {
  it("is false when the last day is the end date", () => {
    expect(entryHasDayAfter({ days: [{ onDate: "2026-06-30" }] }, "2026-06-30")).toBe(false);
    expect(entryHasDayAfter({ days: [{ onDate: "2026-07-01" }] }, "2026-06-30")).toBe(true);
  });
});

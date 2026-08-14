import { describe, expect, it } from "vitest";
import {
  calendarPayloadHasPrivateFields,
  monthCells,
  monthEnd,
  parseCalendarMonth,
  parseCalendarRange,
  readTeamCalendar,
  redactCalendarPerson,
  shiftYearMonth,
  updateTeamCalendarFlags,
  type CalendarPersonRaw,
  type CalendarStore,
} from "./calendar";

const alice = { id: "alice", role: "employee" as const };
const admin = { id: "admin", role: "admin" as const };

const sickNote: CalendarPersonRaw = {
  employeeId: "bob",
  name: "Bob",
  onDate: "2026-08-12",
  portion: "full",
  leaveTypeName: "Sick",
  leaveTypeCode: "sick",
  note: "migraine / diagnosis",
  adminNote: "HR: doctor note on file",
};

function store(overrides: Partial<CalendarStore> = {}): CalendarStore {
  return {
    loadOrgContext: async () => ({
      timezone: "UTC",
      showType: false,
      enabled: true,
    }),
    loadOutDays: async () => [sickNote],
    ...overrides,
  };
}

describe("redactCalendarPerson", () => {
  it("never copies notes and hides type unless the org flag is on", () => {
    const hidden = redactCalendarPerson(sickNote, false);
    expect(hidden).toEqual({
      employeeId: "bob",
      name: "Bob",
      onDate: "2026-08-12",
      portion: "full",
    });
    expect(hidden).not.toHaveProperty("note");
    expect(hidden).not.toHaveProperty("adminNote");
    expect(hidden).not.toHaveProperty("leaveTypeName");
    expect(hidden).not.toHaveProperty("leaveTypeCode");

    expect(redactCalendarPerson(sickNote, true)).toEqual({
      employeeId: "bob",
      name: "Bob",
      onDate: "2026-08-12",
      portion: "full",
      leaveTypeName: "Sick",
    });
  });
});

describe("readTeamCalendar privacy", () => {
  it("redacts the same way for employees and admins", async () => {
    const employeeView = await readTeamCalendar({
      actor: alice,
      orgId: "org-1",
      from: "2026-08-01",
      to: "2026-08-31",
      store: store(),
    });
    const adminView = await readTeamCalendar({
      actor: admin,
      orgId: "org-1",
      from: "2026-08-01",
      to: "2026-08-31",
      store: store(),
    });

    expect(employeeView).toEqual(adminView);
    expect(employeeView).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        showType: false,
        people: [
          {
            employeeId: "bob",
            name: "Bob",
            onDate: "2026-08-12",
            portion: "full",
          },
        ],
      },
    });
    expect(calendarPayloadHasPrivateFields(employeeView.body)).toBe(false);
    expect(JSON.stringify(employeeView.body)).not.toMatch(/note|Sick|diagnosis/i);
  });

  it("includes leave type name only when team_calendar_show_type is true", async () => {
    const result = await readTeamCalendar({
      actor: alice,
      orgId: "org-1",
      from: "2026-08-01",
      to: "2026-08-31",
      store: store({
        loadOrgContext: async () => ({ timezone: "UTC", showType: true, enabled: true }),
      }),
    });
    expect(result).toMatchObject({
      status: 200,
      body: {
        enabled: true,
        showType: true,
        people: [{ leaveTypeName: "Sick" }],
      },
    });
    expect(calendarPayloadHasPrivateFields(result.body)).toBe(false);
  });

  it("returns no people when the calendar is off — even if days exist", async () => {
    const result = await readTeamCalendar({
      actor: alice,
      orgId: "org-1",
      from: "2026-08-01",
      to: "2026-08-31",
      store: store({
        loadOrgContext: async () => ({ timezone: "UTC", showType: true, enabled: false }),
        loadOutDays: async () => {
          throw new Error("must not load out days while calendar is off");
        },
      }),
    });
    expect(result).toEqual({
      status: 200,
      body: { enabled: false, showType: false, people: [] },
    });
  });

  it("only admin can flip calendar flags", async () => {
    await expect(
      updateTeamCalendarFlags({ actor: alice, orgId: "org-1", enabled: true }),
    ).resolves.toEqual({ ok: false, status: 403, error: "forbidden" });
    await expect(
      updateTeamCalendarFlags({ actor: null, orgId: "org-1", enabled: true }),
    ).resolves.toEqual({ ok: false, status: 401, error: "unauthenticated" });
  });

  it("returns 401 when anonymous", async () => {
    const result = await readTeamCalendar({
      actor: null,
      orgId: "org-1",
      from: "2026-08-01",
      to: "2026-08-31",
      store: store({
        loadOutDays: async () => {
          throw new Error("must not load");
        },
      }),
    });
    expect(result.status).toBe(401);
  });
});

describe("month helpers", () => {
  it("builds a Monday-first August 2026 grid", () => {
    expect(monthEnd(2026, 8)).toBe("2026-08-31");
    const cells = monthCells(2026, 8);
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: "2026-07-27", inMonth: false, weekday: 1 });
    expect(cells[5]).toEqual({ date: "2026-08-01", inMonth: true, weekday: 6 });
    expect(shiftYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("defaults month to the org-local civil date", () => {
    expect(
      parseCalendarMonth(undefined, undefined, "UTC", new Date("2026-03-15T23:00:00.000Z")),
    ).toEqual({ year: 2026, month: 3 });
    expect(parseCalendarMonth("2026", "13", "UTC")).toEqual({
      error: "month must be an integer from 1 to 12",
    });
  });

  it("rejects inverted or huge ranges", () => {
    expect(parseCalendarRange("2026-08-31", "2026-08-01")).toEqual({
      error: "to must be on or after from",
    });
    const tooLong = parseCalendarRange("2026-01-01", "2026-05-01");
    expect("error" in tooLong && tooLong.error).toMatch(/93 days/);
  });
});

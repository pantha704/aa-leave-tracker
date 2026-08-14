import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { CalendarStore } from "@/server/calendar";
import { getTeamCalendar } from "./route";

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

const leakingStore: CalendarStore = {
  loadOrgContext: async () => ({ timezone: "UTC", showType: false, enabled: true }),
  loadOutDays: async () => [
    {
      employeeId: "bob",
      name: "Bob",
      onDate: "2026-08-12",
      portion: "full",
      leaveTypeName: "Sick",
      leaveTypeCode: "sick",
      note: "secret diagnosis",
      adminNote: "do not show",
    },
  ],
};

describe("GET /api/calendar", () => {
  it("returns 401 when anonymous", async () => {
    const res = await getTeamCalendar(req("/api/calendar?from=2026-08-01&to=2026-08-31"), {
      getAuthzActor: async () => null,
      loadOrgId: async () => {
        throw new Error("must not load org");
      },
      store: leakingStore,
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("returns no people when the calendar is off and does not load days", async () => {
    const res = await getTeamCalendar(req("/api/calendar?from=2026-08-01&to=2026-08-31"), {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      store: {
        loadOrgContext: async () => ({ timezone: "UTC", showType: true, enabled: false }),
        loadOutDays: async () => {
          throw new Error("must not load out days while calendar is off");
        },
      },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ enabled: false, showType: false, people: [] });
  });

  it("returns 400 for an impossible civil date", async () => {
    const res = await getTeamCalendar(req("/api/calendar?from=2026-02-31&to=2026-03-01"), {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      store: leakingStore,
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "from and to must be YYYY-MM-DD" });
  });

  it("lets an employee read colleagues without notes or type", async () => {
    const res = await getTeamCalendar(req("/api/calendar?from=2026-08-01&to=2026-08-31"), {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      store: leakingStore,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/note|Sick|diagnosis/i);
    expect(body.people[0]).toEqual({
      employeeId: "bob",
      name: "Bob",
      onDate: "2026-08-12",
      portion: "full",
    });
  });
});

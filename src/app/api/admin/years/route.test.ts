import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { postAdminYearClose } from "./[year]/close/route";
import { postAdminYearOpen } from "./[year]/open/route";
import { getAdminYearPreview } from "./[year]/preview/route";
import { postAdminYearReopen } from "./[year]/reopen/route";
import { getAdminYears } from "./route";

function req(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(path, "http://localhost"), init);
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("admin year-end API", () => {
  it("employee receives 403 on list/preview/close/reopen/open", async () => {
    const list = await getAdminYears(req("/api/admin/years"), {
      ...employeeGate,
      list: async () => {
        throw new Error("must not list");
      },
    });
    expect(list.status).toBe(403);

    const preview = await getAdminYearPreview(req("/api/admin/years/2026/preview"), "2026", {
      ...employeeGate,
      preview: async () => {
        throw new Error("must not preview");
      },
    });
    expect(preview.status).toBe(403);

    const close = await postAdminYearClose(
      req("/api/admin/years/2026/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      "2026",
      {
        ...employeeGate,
        close: async () => {
          throw new Error("must not close");
        },
      },
    );
    expect(close.status).toBe(403);

    const reopen = await postAdminYearReopen(
      req("/api/admin/years/2026/reopen", { method: "POST" }),
      "2026",
      {
        ...employeeGate,
        reopen: async () => {
          throw new Error("must not reopen");
        },
      },
    );
    expect(reopen.status).toBe(403);

    const open = await postAdminYearOpen(
      req("/api/admin/years/2026/open", { method: "POST" }),
      "2026",
      {
        ...employeeGate,
        open: async () => {
          throw new Error("must not open");
        },
      },
    );
    expect(open.status).toBe(403);
  });

  it("admin can list periods", async () => {
    const res = await getAdminYears(req("/api/admin/years"), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      list: async () => [{ year: 2026, status: "open", closedAt: null, closedBy: null }],
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      periods: [{ year: 2026, status: "open", closedAt: null, closedBy: null }],
    });
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getAdminPendingCount } from "./route";

function req() {
  return new NextRequest(new URL("/api/admin/pending_count", "http://localhost"));
}

describe("GET /api/admin/pending_count", () => {
  it("employee receives 403", async () => {
    const res = await getAdminPendingCount(req(), {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      countPending: async () => {
        throw new Error("must not count");
      },
    });
    expect(res.status).toBe(403);
  });

  it("admin receives the org pending count", async () => {
    const res = await getAdminPendingCount(req(), {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      countPending: async (orgId) => {
        expect(orgId).toBe("org-1");
        return 4;
      },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pendingCount: 4 });
  });
});

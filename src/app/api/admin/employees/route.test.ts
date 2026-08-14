import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { InviteDeps, InviteStore, RosterActor } from "@/server/invite";
import { postAdminEmployees } from "./route";

const admin: RosterActor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin",
  orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function req(body: unknown) {
  return new NextRequest(new URL("/api/admin/employees", "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unusedStore(): InviteStore {
  return {
    insertEmployee: async () => {
      throw new Error("must not insert employee");
    },
    insertInvite: async () => {
      throw new Error("must not insert invite");
    },
    findOpenInviteByTokenHash: async () => null,
    acceptInvite: async () => {
      throw new Error("must not accept");
    },
  };
}

describe("POST /api/admin/employees", () => {
  it("employee cannot create employees (403)", async () => {
    const invite: InviteDeps = { store: unusedStore(), writeAudit: async () => {} };
    const res = await postAdminEmployees(req({ name: "X", email: "x@y.z", startDate: "2026-01-01" }), {
      getRosterActor: async () => ({
        id: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        orgId: admin.orgId,
      }),
      invite,
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });
});

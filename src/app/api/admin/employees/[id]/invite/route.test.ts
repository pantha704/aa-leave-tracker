import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { InviteDeps, InviteStore } from "@/server/invite";
import { postAdminEmployeeInvite } from "./route";

function req(id: string) {
  return new NextRequest(new URL(`/api/admin/employees/${id}/invite`, "http://localhost"), {
    method: "POST",
  });
}

function unusedStore(): InviteStore {
  return {
    insertEmployeeWithInvite: async () => {
      throw new Error("must not insert employee");
    },
    findEmployeeById: async () => {
      throw new Error("must not load employee");
    },
    replaceOpenInvite: async () => {
      throw new Error("must not replace invite");
    },
    findOpenInviteByTokenHash: async () => null,
    acceptInvite: async () => {
      throw new Error("must not accept");
    },
  };
}

describe("POST /api/admin/employees/:id/invite", () => {
  it("employee cannot re-issue invites (403)", async () => {
    const invite: InviteDeps = { store: unusedStore(), writeAudit: async () => {} };
    const res = await postAdminEmployeeInvite(req("emp-1"), "emp-1", {
      getRosterActor: async () => ({
        id: "22222222-2222-4222-8222-222222222222",
        role: "employee",
        orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      invite,
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
  });
});

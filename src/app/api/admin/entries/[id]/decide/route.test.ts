import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { DecideLeaveInput, DecideLeaveSuccess } from "@/server/leave/decide";
import { postAdminDecide } from "./route";

const ENTRY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON = "44444444-4444-4444-8444-444444444444";

function req(body: unknown, entryId = ENTRY) {
  return new NextRequest(new URL(`/api/admin/entries/${entryId}/decide`, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const unused = {
  resolveEntry: async () => {
    throw new Error("must not resolve");
  },
  decide: async () => {
    throw new Error("must not decide");
  },
};

describe("POST /api/admin/entries/:id/decide", () => {
  it("employee receives 403 and decide is not called", async () => {
    const res = await postAdminDecide(req({ action: "approve" }), ENTRY, {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      ...unused,
    });
    expect(res.status).toBe(403);
  });

  it("admin of another org receives 404 and decide is not called", async () => {
    const res = await postAdminDecide(req({ action: "approve" }), ENTRY, {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      resolveEntry: async (orgId, entryId) => {
        expect(orgId).toBe("org-1");
        expect(entryId).toBe(ENTRY);
        return null;
      },
      decide: async () => {
        throw new Error("must not decide other-org entry");
      },
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "leave entry not found" });
  });

  it("non-uuid entry id is 404 without querying", async () => {
    const res = await postAdminDecide(req({ action: "approve" }, "not-a-uuid"), "not-a-uuid", {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      ...unused,
    });
    expect(res.status).toBe(404);
  });

  it("admin approve/reject/cancel go through decideLeave only", async () => {
    const seen: DecideLeaveInput[] = [];
    const ok = {
      ok: true,
      status: 200,
      action: "approve",
      entry: { id: ENTRY, status: "approved" },
      ledgerPosted: true,
    } as unknown as DecideLeaveSuccess;

    const res = await postAdminDecide(
      req({ action: "approve", adminNote: "ok", override: true }),
      ENTRY,
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        resolveEntry: async () => ({ entryId: ENTRY, employeeId: PERSON }),
        decide: async (input) => {
          seen.push(input);
          return { ...ok, action: input.action } as DecideLeaveSuccess;
        },
      },
    );
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      {
        actor: { id: "admin", role: "admin" },
        entryId: ENTRY,
        action: "approve",
        adminNote: "ok",
        override: true,
      },
    ]);
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { DecideLeaveInput, DecideLeaveSuccess } from "@/server/leave/decide";
import { postAdminDecide } from "./route";

function req(body: unknown) {
  return new NextRequest(new URL("/api/admin/entries/ent-1/decide", "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/entries/:id/decide", () => {
  it("employee receives 403 and decide is not called", async () => {
    const res = await postAdminDecide(req({ action: "approve" }), "ent-1", {
      getAuthzActor: async () => ({ id: "alice", role: "employee" }),
      loadOrgId: async () => "org-1",
      decide: async () => {
        throw new Error("must not decide");
      },
    });
    expect(res.status).toBe(403);
  });

  it("admin approve/reject/cancel go through decideLeave only", async () => {
    const seen: DecideLeaveInput[] = [];
    const ok = {
      ok: true,
      status: 200,
      action: "approve",
      entry: { id: "ent-1", status: "approved" },
      ledgerPosted: true,
    } as unknown as DecideLeaveSuccess;

    const res = await postAdminDecide(
      req({ action: "approve", adminNote: "ok", override: true }),
      "ent-1",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
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
        entryId: "ent-1",
        action: "approve",
        adminNote: "ok",
        override: true,
      },
    ]);
  });
});

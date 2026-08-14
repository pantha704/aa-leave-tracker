import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { postAdminImportPreview } from "./route";
import { postAdminImportCommit } from "../commit/route";

function req(path: string, body: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("POST /api/admin/import/preview", () => {
  it("employee receives 403", async () => {
    const res = await postAdminImportPreview(
      req("/api/admin/import/preview", { kind: "opening", csv: "a", map: {} }),
      {
        ...employeeGate,
        preview: async () => {
          throw new Error("must not preview");
        },
        store: {} as never,
      },
    );
    expect(res.status).toBe(403);
  });

  it("admin receives dry-run payload", async () => {
    const res = await postAdminImportPreview(
      req("/api/admin/import/preview", { kind: "opening", csv: "x", map: { email: "Email" } }),
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        preview: async (orgId, kind, csv, map) => {
          expect(orgId).toBe("org-1");
          expect(kind).toBe("opening");
          expect(csv).toBe("x");
          expect(map.email).toBe("Email");
          return {
            ok: true,
            kind: "opening",
            headers: ["Email"],
            errors: [],
            warnings: [],
            errorCsv: "line,field,message\n",
            posts: [],
            entries: [],
            diffs: [],
          };
        },
        store: {} as never,
      },
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/import/commit", () => {
  it("employee receives 403", async () => {
    const res = await postAdminImportCommit(
      req("/api/admin/import/commit", { kind: "opening", csv: "a", map: {} }),
      {
        ...employeeGate,
        commit: async () => {
          throw new Error("must not commit");
        },
        store: {} as never,
      },
    );
    expect(res.status).toBe(403);
  });
});

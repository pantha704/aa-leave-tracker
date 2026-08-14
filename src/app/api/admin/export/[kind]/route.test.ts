import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "@/server/audit";
import { terminationRowsToCsv } from "@/server/export";
import { getAdminExport } from "./route";

function req(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

const employeeGate = {
  getAuthzActor: async () => ({ id: "alice", role: "employee" as const }),
  loadOrgId: async () => "org-1",
};

describe("GET /api/admin/export/:kind.csv", () => {
  it("employee receives 403 and does not build or audit", async () => {
    const events: AuditEventInput[] = [];
    const res = await getAdminExport(req("/api/admin/export/balances.csv"), "balances.csv", {
      ...employeeGate,
      build: async () => {
        throw new Error("must not export");
      },
      writeAudit: async (event) => {
        events.push(event);
      },
    });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "forbidden" });
    expect(events).toEqual([]);
  });

  it("unknown kind is 400", async () => {
    const res = await getAdminExport(req("/api/admin/export/payroll.csv"), "payroll.csv", {
      getAuthzActor: async () => ({ id: "admin", role: "admin" }),
      loadOrgId: async () => "org-1",
      build: async () => {
        throw new Error("must not export");
      },
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "unknown export kind" });
  });

  it("admin download of balances, entries, and ledger is audited", async () => {
    for (const kind of ["balances", "entries", "ledger"] as const) {
      const events: AuditEventInput[] = [];
      const res = await getAdminExport(req(`/api/admin/export/${kind}.csv`), `${kind}.csv`, {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        build: async (input) => {
          expect(input.kind).toBe(kind);
          expect(input.orgId).toBe("org-1");
          return { ok: true, csv: "h\n", filename: `${kind}.csv`, rowCount: 0, kind };
        },
        writeAudit: async (event) => {
          events.push(event);
        },
      });
      expect(res.status).toBe(200);
      expect(events).toEqual([
        {
          actorId: "admin",
          action: `export.${kind}.download`,
          entityType: "export",
          entityId: "org-1",
          after: { kind, filename: `${kind}.csv`, rowCount: 0, employeeId: null },
        },
      ]);
    }
  });

  it("admin download is audited for termination", async () => {
    const events: AuditEventInput[] = [];
    const csv = terminationRowsToCsv([]);
    const res = await getAdminExport(
      req("/api/admin/export/termination.csv?endDate=2026-06-30"),
      "termination.csv",
      {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        build: async (input) => {
          expect(input).toMatchObject({
            orgId: "org-1",
            kind: "termination",
            endDate: "2026-06-30",
          });
          return { ok: true, csv, filename: "termination-2026-06-30.csv", rowCount: 0, kind: "termination" };
        },
        writeAudit: async (event) => {
          events.push(event);
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toContain("termination-2026-06-30.csv");
    expect(await res.text()).toBe(csv);
    expect(events).toEqual([
      {
        actorId: "admin",
        action: "export.termination.download",
        entityType: "export",
        entityId: "org-1",
        after: {
          kind: "termination",
          filename: "termination-2026-06-30.csv",
          rowCount: 0,
          employeeId: null,
        },
      },
    ]);
  });

  it("still returns the file when audit write throws", async () => {
    const prev = console.error;
    console.error = () => {};
    try {
      const csv = "email,leave_type\n";
      const res = await getAdminExport(req("/api/admin/export/entries.csv"), "entries.csv", {
        getAuthzActor: async () => ({ id: "admin", role: "admin" }),
        loadOrgId: async () => "org-1",
        build: async () => ({
          ok: true,
          csv,
          filename: "entries-2026-01-01.csv",
          rowCount: 0,
          kind: "entries",
        }),
        writeAudit: async () => {
          throw new Error("audit down");
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(csv);
    } finally {
      console.error = prev;
    }
  });
});

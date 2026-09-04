import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { applyAuthGate, authorizeAdmin, mustChangePasswordNow } from "./auth-gate";

function get(path: string) {
  return new NextRequest(new URL(path, "http://localhost"));
}

describe("auth gate", () => {
  it("employee cannot GET /admin (403)", () => {
    const res = applyAuthGate(get("/admin"), {
      kind: "authenticated",
      role: "employee",
      mustChangePassword: false,
    });
    expect(res.status).toBe(403);
  });

  it("employee cannot GET holiday or leave-type admin pages (403)", () => {
    const actor = {
      kind: "authenticated" as const,
      role: "employee" as const,
      mustChangePassword: false,
    };
    expect(applyAuthGate(get("/admin/holidays"), actor).status).toBe(403);
    expect(applyAuthGate(get("/admin/leave-types"), actor).status).toBe(403);
    expect(applyAuthGate(get("/admin/import"), actor).status).toBe(403);
  });

  it("unauthenticated GET /me is redirected or 401", () => {
    const res = applyAuthGate(get("/me"), { kind: "anonymous" });
    expect([301, 302, 303, 307, 308, 401]).toContain(res.status);
    if (res.status !== 401) {
      expect(res.headers.get("location")).toMatch(/\/login$/);
    }
  });

  it("health stays public", () => {
    const res = applyAuthGate(get("/api/health"), { kind: "anonymous" });
    expect(res.status).toBe(200);
  });

  it("admin can GET /admin and /me", () => {
    const actor = {
      kind: "authenticated" as const,
      role: "admin" as const,
      mustChangePassword: false,
    };
    expect(applyAuthGate(get("/admin"), actor).status).toBe(200);
    expect(applyAuthGate(get("/me"), actor).status).toBe(200);
  });

  it("unauthenticated GET /calendar is redirected to login", () => {
    const res = applyAuthGate(get("/calendar"), { kind: "anonymous" });
    expect([301, 302, 303, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/login$/);
  });

  it("employee and admin can GET /calendar", () => {
    const employee = {
      kind: "authenticated" as const,
      role: "employee" as const,
      mustChangePassword: false,
    };
    const admin = {
      kind: "authenticated" as const,
      role: "admin" as const,
      mustChangePassword: false,
    };
    expect(applyAuthGate(get("/calendar"), employee).status).toBe(200);
    expect(applyAuthGate(get("/calendar"), admin).status).toBe(200);
  });

  it("forces change-password before any other page", () => {
    const actor = {
      kind: "authenticated" as const,
      role: "admin" as const,
      mustChangePassword: true,
    };
    const res = applyAuthGate(get("/admin"), actor);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toMatch(/\/login\/change-password$/);
    expect(applyAuthGate(get("/login/change-password"), actor).status).toBe(200);
  });
});

describe("DAL authorizeAdmin", () => {
  it("employee cannot GET /admin (403)", () => {
    expect(
      authorizeAdmin({
        role: "employee",
        mustChangePassword: false,
        active: true,
      }),
    ).toEqual({ status: "forbidden" });
  });

  it("manager cannot GET /admin (403)", () => {
    expect(
      authorizeAdmin({
        role: "manager",
        mustChangePassword: false,
        active: true,
      }),
    ).toEqual({ status: "forbidden" });
  });

  it("admin is allowed on /admin", () => {
    expect(
      authorizeAdmin({
        role: "admin",
        mustChangePassword: false,
        active: true,
      }),
    ).toEqual({ status: "ok" });
  });

  it("denies /admin when membership permissions are explicitly empty despite legacy admin role", () => {
    expect(
      authorizeAdmin({
        role: "admin",
        permissions: [],
        mustChangePassword: false,
        active: true,
      }),
    ).toEqual({ status: "forbidden" });
    const res = applyAuthGate(get("/admin"), {
      kind: "authenticated",
      role: "admin",
      permissions: [],
      mustChangePassword: false,
    });
    expect(res.status).toBe(403);
  });

  it("mustChangePassword blocks other pages at the DAL", () => {
    expect(
      mustChangePasswordNow({
        role: "admin",
        mustChangePassword: true,
        active: true,
      }),
    ).toBe(true);
    expect(
      authorizeAdmin({
        role: "admin",
        mustChangePassword: true,
        active: true,
      }),
    ).toEqual({ status: "must_change_password" });
  });
});

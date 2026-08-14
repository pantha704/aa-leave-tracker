import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { applyAuthGate } from "./auth-gate";

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

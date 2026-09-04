import { NextRequest, NextResponse } from "next/server";
import { canAccessAdminPortal, type Permission } from "./permissions";

export type EmployeeRole = "employee" | "manager" | "admin";

export type Actor =
  | { kind: "anonymous" }
  | {
      kind: "authenticated";
      role: EmployeeRole;
      permissions?: readonly Permission[];
      mustChangePassword: boolean;
    };

export type EmployeeAccess = {
  role: EmployeeRole;
  permissions?: readonly Permission[];
  mustChangePassword: boolean;
  active: boolean;
};

export type AdminDecision =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "must_change_password" }
  | { status: "forbidden" };

export function homeForRole(role: EmployeeRole): string {
  return role === "admin" ? "/admin" : "/me";
}

export function homeForActor(actor: {
  role: EmployeeRole;
  permissions?: readonly Permission[];
}): string {
  if (actor.permissions !== undefined) {
    return canAccessAdminPortal(actor) ? "/admin" : "/me";
  }
  return homeForRole(actor.role);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isMePath(pathname: string): boolean {
  return pathname === "/me" || pathname.startsWith("/me/");
}

export function isCalendarPath(pathname: string): boolean {
  return pathname === "/calendar" || pathname.startsWith("/calendar/");
}

function isHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/health/");
}

function isAuthApiPath(pathname: string): boolean {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

/** Page/DAL authorization. Employees must get 403, not 404 or a login bounce. */
export function authorizeAdmin(employee: EmployeeAccess | null | undefined): AdminDecision {
  if (!employee?.active) {
    return { status: "unauthenticated" };
  }
  if (employee.mustChangePassword) {
    return { status: "must_change_password" };
  }
  if (employee.permissions !== undefined) {
    if (!canAccessAdminPortal(employee)) return { status: "forbidden" };
    return { status: "ok" };
  }
  if (employee.role !== "admin") {
    return { status: "forbidden" };
  }
  return { status: "ok" };
}

export function mustChangePasswordNow(employee: EmployeeAccess | null | undefined): boolean {
  return Boolean(employee?.active && employee.mustChangePassword);
}

export function applyAuthGate(request: NextRequest, actor: Actor): NextResponse {
  const pathname = request.nextUrl.pathname;

  if (isHealthPath(pathname) || isAuthApiPath(pathname)) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  const isLogin = pathname === "/login";
  const isChangePassword = pathname === "/login/change-password";
  const needsAuth =
    isMePath(pathname) || isAdminPath(pathname) || isCalendarPath(pathname) || isChangePassword;

  if (actor.kind === "anonymous") {
    if (needsAuth) {
      const login = new URL("/login", request.url);
      return NextResponse.redirect(login);
    }
    return NextResponse.next({ request: { headers: request.headers } });
  }

  if (actor.mustChangePassword && !isChangePassword) {
    return NextResponse.redirect(new URL("/login/change-password", request.url));
  }

  if (isAdminPath(pathname)) {
    const portalOk =
      actor.permissions !== undefined ? canAccessAdminPortal(actor) : actor.role === "admin";
    if (!portalOk) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  if ((isLogin || isChangePassword) && !actor.mustChangePassword) {
    return NextResponse.redirect(new URL(homeForActor(actor), request.url));
  }

  return NextResponse.next({ request: { headers: request.headers } });
}

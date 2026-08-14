import { NextRequest, NextResponse } from "next/server";

export type EmployeeRole = "employee" | "manager" | "admin";

export type Actor =
  | { kind: "anonymous" }
  | {
      kind: "authenticated";
      role: EmployeeRole;
      mustChangePassword: boolean;
    };

export function homeForRole(role: EmployeeRole): string {
  return role === "admin" ? "/admin" : "/me";
}

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function isMePath(pathname: string): boolean {
  return pathname === "/me" || pathname.startsWith("/me/");
}

function isHealthPath(pathname: string): boolean {
  return pathname === "/api/health" || pathname.startsWith("/api/health/");
}

function isAuthApiPath(pathname: string): boolean {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export function applyAuthGate(request: NextRequest, actor: Actor): NextResponse {
  const pathname = request.nextUrl.pathname;

  if (isHealthPath(pathname) || isAuthApiPath(pathname)) {
    return NextResponse.next();
  }

  const isLogin = pathname === "/login";
  const isChangePassword = pathname === "/login/change-password";
  const needsAuth = isMePath(pathname) || isAdminPath(pathname) || isChangePassword;

  if (actor.kind === "anonymous") {
    if (needsAuth) {
      const login = new URL("/login", request.url);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  if (actor.mustChangePassword && !isChangePassword) {
    return NextResponse.redirect(new URL("/login/change-password", request.url));
  }

  if (isAdminPath(pathname) && actor.role !== "admin") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if ((isLogin || isChangePassword) && !actor.mustChangePassword) {
    return NextResponse.redirect(new URL(homeForRole(actor.role), request.url));
  }

  return NextResponse.next();
}

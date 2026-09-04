import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getSessionCookie } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { NextRequest } from "next/server";
import * as authSchema from "@/db/auth-schema";
import { employees } from "@/db/schema";
import {
  authorizeAdmin,
  mustChangePasswordNow,
  type Actor,
  type EmployeeAccess,
  type EmployeeRole,
} from "./auth-gate";
import type { AuthzActor } from "./authz";
import { getDatabaseUrl, getDb } from "./db";
import {
  employeesForAuthUser,
  pickOrgId,
  selectEmployeeForOrg,
  toAuthzActor,
} from "./membership";

export {
  applyAuthGate,
  authorizeAdmin,
  homeForRole,
  isAdminPath,
  isCalendarPath,
  isMePath,
  mustChangePasswordNow,
  type Actor,
  type AdminDecision,
  type EmployeeAccess,
  type EmployeeRole,
} from "./auth-gate";

export const emailAndPasswordConfig = {
  enabled: true,
  disableSignUp: true,
  minPasswordLength: 6,
} as const;

export function sessionCookieAttributes(
  env: Partial<Record<string, string | undefined>> = process.env,
) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
  };
}

export function requireBetterAuthSecret(
  env: Partial<Record<string, string | undefined>> = process.env,
): string {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  return secret;
}

function createAuth() {
  const secret = requireBetterAuthSecret();
  if (!getDatabaseUrl()) {
    throw new Error("DATABASE_URL is required for authentication");
  }

  return betterAuth({
    appName: "Absolute Addiction Leave",
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: emailAndPasswordConfig,
    advanced: {
      defaultCookieAttributes: sessionCookieAttributes(),
    },
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let authInstance: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}

function toAccess(
  employee: {
    role: string;
    mustChangePassword: boolean;
    active: boolean;
  },
  permissions?: EmployeeAccess["permissions"],
): EmployeeAccess {
  return {
    role: employee.role as EmployeeRole,
    permissions,
    mustChangePassword: employee.mustChangePassword,
    active: employee.active,
  };
}

export async function findEmployeeByUser(
  user: { id: string; email: string },
  preferredOrgId?: string,
) {
  const rows = await employeesForAuthUser(user.id, user.email);
  const match = selectEmployeeForOrg(rows, preferredOrgId);
  if (!match) return undefined;

  if (!match.authUserId) {
    await getDb()
      .update(employees)
      .set({ authUserId: user.id })
      .where(eq(employees.id, match.id));
    return { ...match, authUserId: user.id };
  }

  return match;
}

export async function getRequestActor(request: NextRequest): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.email) {
    return { kind: "anonymous" };
  }

  const employee = await findEmployeeByUser(session.user, pickOrgId(request.headers));
  if (!employee?.active) {
    return { kind: "anonymous" };
  }

  const actor = await toAuthzActor(employee);
  return {
    kind: "authenticated",
    role: employee.role as EmployeeRole,
    permissions: actor.permissions,
    mustChangePassword: employee.mustChangePassword,
  };
}

export async function getAuthzActor(request: NextRequest): Promise<AuthzActor | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.email) return null;

  const employee = await findEmployeeByUser(session.user, pickOrgId(request.headers));
  if (!employee?.active) return null;
  if (mustChangePasswordNow(toAccess(employee))) return null;

  return toAuthzActor(employee);
}

export type RosterActor = AuthzActor & { orgId: string };

export async function getRosterActor(request: NextRequest): Promise<RosterActor | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.email) return null;

  const employee = await findEmployeeByUser(session.user, pickOrgId(request.headers));
  if (!employee?.active) return null;
  if (mustChangePasswordNow(toAccess(employee))) return null;

  const actor = await toAuthzActor(employee);
  return {
    ...actor,
    orgId: employee.orgId,
  };
}

export async function requireNotMustChangePassword() {
  const sessionCookie = getSessionCookie(await headers());
  if (!sessionCookie) return;

  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user) return;

  const employee = await findEmployeeByUser(session.user, pickOrgId(requestHeaders));
  if (mustChangePasswordNow(employee ? toAccess(employee) : null)) {
    redirect("/login/change-password");
  }
}

export async function requireEmployee() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/login");
  }

  const employee = await findEmployeeByUser(session.user, pickOrgId(requestHeaders));
  if (!employee?.active) {
    redirect("/login");
  }

  if (mustChangePasswordNow(toAccess(employee))) {
    redirect("/login/change-password");
  }

  const actor = await toAuthzActor(employee);
  return { session, employee, actor };
}

export async function requireAdmin() {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect("/login");
  }

  const employee = await findEmployeeByUser(session.user, pickOrgId(requestHeaders));
  const actor = employee ? await toAuthzActor(employee) : null;
  const decision = authorizeAdmin(
    employee ? toAccess(employee, actor?.permissions) : null,
  );
  if (decision.status === "unauthenticated") {
    redirect("/login");
  }
  if (decision.status === "must_change_password") {
    redirect("/login/change-password");
  }
  if (decision.status === "forbidden") {
    forbidden();
  }

  return { session, employee: employee!, actor: actor! };
}

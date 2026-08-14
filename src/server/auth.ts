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
import { getDatabaseUrl, getDb } from "./db";

export {
  applyAuthGate,
  authorizeAdmin,
  homeForRole,
  isAdminPath,
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

function toAccess(employee: {
  role: string;
  mustChangePassword: boolean;
  active: boolean;
}): EmployeeAccess {
  return {
    role: employee.role as EmployeeRole,
    mustChangePassword: employee.mustChangePassword,
    active: employee.active,
  };
}

export async function findEmployeeByUser(user: { id: string; email: string }) {
  const db = getDb();
  const [byAuthId] = await db
    .select()
    .from(employees)
    .where(eq(employees.authUserId, user.id))
    .limit(1);
  if (byAuthId) return byAuthId;

  const [byEmail] = await db
    .select()
    .from(employees)
    .where(eq(employees.email, user.email))
    .limit(1);
  if (!byEmail) return undefined;

  if (!byEmail.authUserId) {
    await db
      .update(employees)
      .set({ authUserId: user.id })
      .where(eq(employees.id, byEmail.id));
    return { ...byEmail, authUserId: user.id };
  }

  return byEmail;
}

export async function getRequestActor(request: NextRequest): Promise<Actor> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user?.email) {
    return { kind: "anonymous" };
  }

  const employee = await findEmployeeByUser(session.user);
  if (!employee?.active) {
    return { kind: "anonymous" };
  }

  return {
    kind: "authenticated",
    role: employee.role as EmployeeRole,
    mustChangePassword: employee.mustChangePassword,
  };
}

export async function requireNotMustChangePassword() {
  const sessionCookie = getSessionCookie(await headers());
  if (!sessionCookie) return;

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return;

  const employee = await findEmployeeByUser(session.user);
  if (mustChangePasswordNow(employee ? toAccess(employee) : null)) {
    redirect("/login/change-password");
  }
}

export async function requireEmployee() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }

  const employee = await findEmployeeByUser(session.user);
  if (!employee?.active) {
    redirect("/login");
  }

  if (mustChangePasswordNow(toAccess(employee))) {
    redirect("/login/change-password");
  }

  return { session, employee };
}

export async function requireAdmin() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }

  const employee = await findEmployeeByUser(session.user);
  const decision = authorizeAdmin(employee ? toAccess(employee) : null);
  if (decision.status === "unauthenticated") {
    redirect("/login");
  }
  if (decision.status === "must_change_password") {
    redirect("/login/change-password");
  }
  if (decision.status === "forbidden") {
    forbidden();
  }

  return { session, employee: employee! };
}

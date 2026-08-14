"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { employees } from "@/db/schema";
import {
  findEmployeeByUser,
  getAuth,
  homeForRole,
  type EmployeeRole,
} from "@/server/auth";
import { getDb } from "@/server/db";
import {
  clientIpFromHeaders,
  consumeLoginAttempt,
  resetLoginAttempts,
} from "@/server/rate-limit";

export type AuthFormState = { error: string } | undefined;

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const ip = clientIpFromHeaders(await headers());
  const limited = consumeLoginAttempt(ip);
  if (!limited.ok) {
    return { error: "Too many login attempts. Try again later." };
  }

  let user: { id: string; email: string };
  try {
    const result = await getAuth().api.signInEmail({
      body: { email, password },
    });
    if (!result.user?.email) {
      return { error: "Invalid email or password" };
    }
    user = result.user;
  } catch {
    return { error: "Invalid email or password" };
  }

  const employee = await findEmployeeByUser(user);
  if (!employee?.active) {
    await getAuth().api.signOut({ headers: await headers() });
    return { error: "No employee record for this account" };
  }

  if (employee.mustChangePassword) {
    resetLoginAttempts(ip);
    redirect("/login/change-password");
  }

  resetLoginAttempts(ip);
  redirect(homeForRole(employee.role as EmployeeRole));
}

export async function changePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (!currentPassword || !newPassword) {
    return { error: "Current and new password are required" };
  }
  if (newPassword.length < 8) {
    return { error: "New password must be at least 8 characters" };
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/login");
  }

  try {
    await getAuth().api.changePassword({
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch {
    return { error: "Could not change password" };
  }

  const employee = await findEmployeeByUser(session.user);
  if (employee) {
    await getDb()
      .update(employees)
      .set({ mustChangePassword: false })
      .where(eq(employees.id, employee.id));
  }

  redirect(homeForRole((employee?.role as EmployeeRole | undefined) ?? "employee"));
}

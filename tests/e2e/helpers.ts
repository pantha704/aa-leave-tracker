import { expect, type Page } from "@playwright/test";

export function employeeCreds(): { email: string; password: string } | null {
  const email = process.env.E2E_EMPLOYEE_EMAIL?.trim();
  const password = process.env.E2E_EMPLOYEE_PASSWORD ?? "";
  if (!email || !password) return null;
  return { email, password };
}

export function adminCreds(): { email: string; password: string } | null {
  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD ?? "";
  if (!email || !password) return null;
  return { email, password };
}

export function importEmail(): string | null {
  return (
    process.env.E2E_IMPORT_EMAIL?.trim() ||
    employeeCreds()?.email ||
    adminCreds()?.email ||
    null
  );
}

export function importLeaveType(): string {
  return process.env.E2E_IMPORT_LEAVE_TYPE?.trim() || "vacation_unpaid";
}

/** Next Mon–Fri on or after the org calendar day (ISO date). */
export function nextWeekday(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  for (let i = 0; i < 8; i++) {
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) return date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return isoDate;
}

/** First Mon–Fri strictly after the org calendar day (future request). */
export function nextFutureWeekday(isoToday: string): string {
  const [year, month, day] = isoToday.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return nextWeekday(date.toISOString().slice(0, 10));
}

export async function readAsOfDate(page: Page): Promise<string> {
  const header = page.locator("header").filter({ hasText: /as of/i }).first();
  const text = (await header.textContent()) ?? "";
  const match = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return new Date().toISOString().slice(0, 10);
}

export async function selectLeaveType(page: Page, hint = /vacation/i) {
  const select = page.locator('select[name="leaveTypeId"]');
  const match = select.locator("option").filter({ hasText: hint });
  if ((await match.count()) > 0) {
    const value = await match.first().getAttribute("value");
    if (value) await select.selectOption(value);
  }
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (page.url().includes("/login/change-password")) {
    const next = process.env.E2E_NEW_PASSWORD?.trim();
    if (!next || next.length < 8) {
      throw new Error(
        "Account requires must_change_password=false, or set E2E_NEW_PASSWORD (min 8 chars).",
      );
    }
    await page.locator('input[name="currentPassword"]').fill(password);
    await page.locator('input[name="newPassword"]').fill(next);
    await page.getByRole("button", { name: "Update password" }).click();
  }

  await expect(page).not.toHaveURL(/\/login(\/change-password)?$/);
}

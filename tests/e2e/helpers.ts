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

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

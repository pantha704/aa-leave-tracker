import { test, expect } from "@playwright/test";
import { employeeCreds, signIn } from "./helpers";

test("login page is reachable", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("unauthenticated /me redirects to login", async ({ page }) => {
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login/);
});

test("employee can log leave", async ({ page }) => {
  const creds = employeeCreds();
  test.skip(!creds, "Set E2E_EMPLOYEE_EMAIL and E2E_EMPLOYEE_PASSWORD");

  await signIn(page, creds!.email, creds!.password);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "My leave" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Log / request" })).toBeVisible();

  const today = new Date().toISOString().slice(0, 10);
  await page.locator('input[name="startDate"]').fill(today);
  await page.locator('input[name="endDate"]').fill(today);
  const submit = page.getByRole("button", { name: "Submit" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("status")).toContainText(/Logged|Requested/);
});

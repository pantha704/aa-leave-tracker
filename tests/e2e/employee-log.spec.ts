import { test, expect } from "@playwright/test";
import { employeeCreds, nextWeekday, readAsOfDate, selectLeaveType, signIn } from "./helpers";

test("login page is reachable", { tag: "@smoke" }, async ({ page }) => {
  const res = await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/default-src 'self'/);
});

test("unauthenticated /me redirects to login", { tag: "@smoke" }, async ({ page }) => {
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

  const asOf = await readAsOfDate(page);
  const day = nextWeekday(asOf);
  await page.locator('input[name="startDate"]').fill(day);
  await page.locator('input[name="endDate"]').fill(day);
  await selectLeaveType(page);
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Submit" }) });
  await expect(form.getByRole("button", { name: "Submit" })).toBeEnabled();
  await form.getByRole("button", { name: "Submit" }).click();
  await expect(form.getByRole("status")).toContainText(/Logged|Requested/);
});

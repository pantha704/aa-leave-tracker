import { test, expect } from "@playwright/test";
import { adminCreds, importEmail, importLeaveType, signIn } from "./helpers";

function openingCsv(email: string, leaveType: string): string {
  return [
    "email,leave_type,as_of,granted_hours,used_hours,remaining_hours,notes",
    `${email},${leaveType},2026-01-01,80,8,72,e2e`,
  ].join("\n");
}

test("unauthenticated import page redirects to login", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/admin/import");
  await expect(page).toHaveURL(/\/login/);
});

test("import dry-run page smoke", async ({ page }) => {
  const creds = adminCreds();
  test.skip(!creds, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

  await signIn(page, creds!.email, creds!.password);
  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "CSV import" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Read headers" })).toBeVisible();
  await expect(page.getByText(/dry-run/i).first()).toBeVisible();
  await expect(page.locator('input[name="file"]')).toBeVisible();
});

test("import dry-run shows remaining-hours diff", async ({ page }) => {
  const creds = adminCreds();
  const email = importEmail();
  test.skip(!creds || !email, "Set E2E_ADMIN_* and E2E_IMPORT_EMAIL or E2E_EMPLOYEE_EMAIL");

  await signIn(page, creds!.email, creds!.password);
  await page.goto("/admin/import");

  await page.locator('select[name="kind"]').selectOption("opening");
  await page.locator('input[name="file"]').setInputFiles({
    name: "opening.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(openingCsv(email!, importLeaveType())),
  });
  await page.getByRole("button", { name: "Read headers" }).click();
  await expect(page.getByRole("heading", { name: "Column map" })).toBeVisible();
  await page.getByRole("button", { name: "Dry-run" }).click();
  await expect(page.getByRole("heading", { name: "Dry-run" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Sheet remaining" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "App remaining" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Adjust (h)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: email! })).toBeVisible();
});

test("import dry-run blocks unknown email", async ({ page }) => {
  const creds = adminCreds();
  test.skip(!creds, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

  await signIn(page, creds!.email, creds!.password);
  await page.goto("/admin/import");

  await page.locator('input[name="file"]').setInputFiles({
    name: "unknown.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(openingCsv("nobody@example.com", importLeaveType())),
  });
  await page.getByRole("button", { name: "Read headers" }).click();
  await page.getByRole("button", { name: "Dry-run" }).click();
  await expect(page.getByText(/error\(s\)\. Commit is blocked/i)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Sheet remaining" })).toHaveCount(0);
});

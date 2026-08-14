import { test, expect } from "@playwright/test";
import { adminCreds, signIn } from "./helpers";

const SAMPLE_CSV = [
  "email,leave_type,as_of,granted_hours,used_hours,remaining_hours,notes",
  "nobody@example.com,VAC,2026-01-01,80,0,80,e2e",
].join("\n");

test("unauthenticated import page redirects to login", async ({ page }) => {
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

test("import dry-run shows remaining diff after preview", async ({ page }) => {
  const creds = adminCreds();
  test.skip(!creds, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

  await signIn(page, creds!.email, creds!.password);
  await page.goto("/admin/import");

  await page.locator('select[name="kind"]').selectOption("opening");
  await page.locator('input[name="file"]').setInputFiles({
    name: "opening.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(SAMPLE_CSV),
  });
  await page.getByRole("button", { name: "Read headers" }).click();
  await expect(page.getByRole("heading", { name: "Column map" })).toBeVisible();
  await page.getByRole("button", { name: "Dry-run" }).click();
  await expect(page.getByRole("heading", { name: "Dry-run" })).toBeVisible();
  // Either a remaining-hours diff table or a blocked dry-run error list.
  const diff = page.getByRole("columnheader", { name: "Sheet remaining" });
  const blocked = page.getByText(/error\(s\)\. Commit is blocked/i);
  await expect(diff.or(blocked).first()).toBeVisible();
});

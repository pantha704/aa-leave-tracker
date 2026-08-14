import { test, expect } from "@playwright/test";
import {
  adminCreds,
  employeeCreds,
  nextFutureWeekday,
  readAsOfDate,
  selectLeaveType,
  signIn,
} from "./helpers";

test("admin can approve a pending employee request", async ({ browser }) => {
  const employee = employeeCreds();
  const admin = adminCreds();
  test.skip(!employee || !admin, "Set E2E_EMPLOYEE_* and E2E_ADMIN_*");

  const empCtx = await browser.newContext();
  const empPage = await empCtx.newPage();
  await signIn(empPage, employee!.email, employee!.password);
  await empPage.goto("/me");
  const day = nextFutureWeekday(await readAsOfDate(empPage));
  await empPage.locator('input[name="startDate"]').fill(day);
  await empPage.locator('input[name="endDate"]').fill(day);
  await selectLeaveType(empPage);
  const empForm = empPage
    .locator("form")
    .filter({ has: empPage.getByRole("button", { name: "Submit" }) });
  await expect(empForm.getByRole("button", { name: "Submit" })).toBeEnabled();
  await empForm.getByRole("button", { name: "Submit" }).click();
  await expect(empForm.getByRole("status")).toContainText(/Requested/);

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signIn(adminPage, admin!.email, admin!.password);
  await adminPage.goto("/admin/employees#pending");
  await expect(adminPage.getByRole("heading", { name: "Pending requests" })).toBeVisible();
  const row = adminPage.locator("#pending tbody tr").filter({ hasText: day });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Approve" }).click();

  await empPage.reload();
  const entryRow = empPage.locator("table tbody tr").filter({ hasText: day });
  await expect(entryRow.getByText("approved", { exact: true })).toBeVisible();

  await empCtx.close();
  await adminCtx.close();
});

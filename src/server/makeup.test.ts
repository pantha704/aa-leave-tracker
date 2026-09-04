import { describe, expect, it } from "vitest";
import { createMakeupEntry } from "./makeup";

describe("createMakeupEntry", () => {
  it("records make-up time outside the PTO ledger", () => {
    const row = createMakeupEntry({
      organizationId: "org-a",
      employeeId: "alice",
      missedDate: "2026-07-06",
      makeupDate: "2026-07-08",
      minutes: 120,
      reason: "client call overrun",
      managerId: "mgr",
    });
    expect(row).toMatchObject({
      status: "pending",
      minutes: 120,
      missedDate: "2026-07-06",
      makeupDate: "2026-07-08",
    });
    expect("ok" in row && row.ok === false).toBe(false);
  });

  it("rejects empty reason or non-positive minutes", () => {
    expect(
      createMakeupEntry({
        organizationId: "org-a",
        employeeId: "alice",
        missedDate: "2026-07-06",
        makeupDate: "2026-07-08",
        minutes: 0,
        reason: "x",
      }),
    ).toMatchObject({ ok: false });
  });
});

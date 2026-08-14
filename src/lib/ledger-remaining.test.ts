import { describe, expect, it } from "vitest";
import { withRunningRemaining } from "./ledger-remaining";

describe("withRunningRemaining", () => {
  it("walks live rows oldest-first then renders newest-first", () => {
    const rows = withRunningRemaining(
      [
        {
          id: "usage",
          kind: "usage",
          minutes: -480,
          effectiveOn: "2026-07-06",
          periodYear: 2026,
          reversedAt: null,
          createdAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "grant",
          kind: "accrual",
          minutes: 1360,
          effectiveOn: "2026-01-01",
          periodYear: 2026,
          reversedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "next",
          kind: "accrual",
          minutes: 680,
          effectiveOn: "2027-01-01",
          periodYear: 2027,
          reversedAt: null,
          createdAt: "2027-01-01T00:00:00.000Z",
        },
      ],
      2026,
    );

    expect(rows.map((row) => row.id)).toEqual(["usage", "grant"]);
    expect(rows[0]?.remainingMinutes).toBe(880);
    expect(rows[1]?.remainingMinutes).toBe(1360);
  });
});

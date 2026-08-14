import { describe, expect, it } from "vitest";
import {
  lockCutoffDate,
  runLockJob,
  shouldLockEntry,
  type LockCandidate,
  type LockJobSource,
} from "./lock";

const TODAY = "2026-08-15";
const WINDOW = 7;
const NOW = new Date("2026-08-15T12:00:00.000Z");

function memorySource(
  entries: Array<LockCandidate & { immutableAt: Date | string | null }>,
  editWindowDays = WINDOW,
): LockJobSource {
  return {
    listOrgs: async () => [{ id: "org", timezone: "UTC", editWindowDays }],
    listApprovedMutable: async () =>
      entries.filter((entry) => entry.status === "approved" && entry.immutableAt == null),
    async setImmutableAt(id, at) {
      const entry = entries.find((row) => row.id === id);
      if (!entry || entry.status !== "approved") return undefined;
      entry.immutableAt = at;
      return { status: entry.status };
    },
  };
}

describe("lock cutoff", () => {
  it("is today minus edit_window_days", () => {
    expect(lockCutoffDate(TODAY, WINDOW)).toBe("2026-08-08");
  });
});

describe("shouldLockEntry", () => {
  it("skips when the edit window has not elapsed", () => {
    expect(
      shouldLockEntry({
        status: "approved",
        endDate: "2026-08-08",
        immutableAt: null,
        today: TODAY,
        editWindowDays: WINDOW,
      }),
    ).toBe(false);
  });

  it("locks when end_date is strictly before today − edit_window_days", () => {
    expect(
      shouldLockEntry({
        status: "approved",
        endDate: "2026-08-07",
        immutableAt: null,
        today: TODAY,
        editWindowDays: WINDOW,
      }),
    ).toBe(true);
  });
});

describe("runLockJob", () => {
  it("skips when the edit window has not elapsed", async () => {
    const entries: LockCandidate[] = [
      { id: "still-open", status: "approved", endDate: "2026-08-08", immutableAt: null },
    ];
    const result = await runLockJob(NOW, memorySource(entries));
    expect(result.locked).toBe(0);
    expect(result.skipped).toBe(1);
    expect(entries[0]?.immutableAt).toBeNull();
    expect(entries[0]?.status).toBe("approved");
  });

  it("sets immutable_at after the window and leaves status approved", async () => {
    const entries: LockCandidate[] = [
      { id: "elapsed", status: "approved", endDate: "2026-08-07", immutableAt: null },
    ];
    const result = await runLockJob(NOW, memorySource(entries));
    expect(result.locked).toBe(1);
    expect(entries[0]?.immutableAt).toEqual(NOW);
    expect(entries[0]?.status).toBe("approved");
  });
});

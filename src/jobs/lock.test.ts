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
  opts: { honorFilters?: boolean } = {},
): LockJobSource {
  const honorFilters = opts.honorFilters !== false;
  return {
    listOrgs: async () => [{ id: "org", timezone: "UTC", editWindowDays }],
    listApprovedMutable: async (_orgId, cutoff) =>
      honorFilters
        ? entries.filter(
            (entry) =>
              entry.status === "approved" && entry.immutableAt == null && entry.endDate < cutoff,
          )
        : [...entries],
    async setImmutableAt(id, at) {
      const entry = entries.find((row) => row.id === id);
      if (!entry || entry.status !== "approved" || entry.immutableAt != null) return undefined;
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

  it("skips pending and cancelled even after the window", () => {
    for (const status of ["pending", "cancelled", "draft", "rejected"] as const) {
      expect(
        shouldLockEntry({
          status,
          endDate: "2026-08-07",
          immutableAt: null,
          today: TODAY,
          editWindowDays: WINDOW,
        }),
      ).toBe(false);
    }
  });

  it("skips an already-stamped approved row", () => {
    expect(
      shouldLockEntry({
        status: "approved",
        endDate: "2026-08-07",
        immutableAt: new Date("2026-08-01T00:00:00.000Z"),
        today: TODAY,
        editWindowDays: WINDOW,
      }),
    ).toBe(false);
  });
});

describe("runLockJob", () => {
  it("skips when the edit window has not elapsed", async () => {
    const entries: LockCandidate[] = [
      { id: "still-open", status: "approved", endDate: "2026-08-08", immutableAt: null },
    ];
    const result = await runLockJob(NOW, memorySource(entries));
    expect(result.considered).toBe(0);
    expect(result.locked).toBe(0);
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

  it("does not stamp pending, cancelled, or already-immutable rows", async () => {
    const stampedAt = new Date("2026-08-01T00:00:00.000Z");
    const entries: LockCandidate[] = [
      { id: "pending", status: "pending", endDate: "2026-08-01", immutableAt: null },
      { id: "cancelled", status: "cancelled", endDate: "2026-08-01", immutableAt: null },
      { id: "stamped", status: "approved", endDate: "2026-08-01", immutableAt: stampedAt },
      { id: "lockable", status: "approved", endDate: "2026-08-01", immutableAt: null },
    ];
    const result = await runLockJob(NOW, memorySource(entries, WINDOW, { honorFilters: false }));
    expect(result.locked).toBe(1);
    expect(result.skipped).toBe(3);
    expect(entries.find((row) => row.id === "pending")?.immutableAt).toBeNull();
    expect(entries.find((row) => row.id === "cancelled")?.immutableAt).toBeNull();
    expect(entries.find((row) => row.id === "stamped")?.immutableAt).toEqual(stampedAt);
    expect(entries.find((row) => row.id === "lockable")?.immutableAt).toEqual(NOW);
    expect(entries.find((row) => row.id === "lockable")?.status).toBe("approved");
  });

  it("stamps the replayed instant when now is an ISO string", async () => {
    const entries: LockCandidate[] = [
      { id: "elapsed", status: "approved", endDate: "2026-08-07", immutableAt: null },
    ];
    const result = await runLockJob("2026-08-15T12:00:00.000Z", memorySource(entries));
    expect(result.locked).toBe(1);
    expect(entries[0]?.immutableAt).toEqual(NOW);
  });
});

import { describe, expect, it } from "vitest";
import { DEMO_WORKDAY_MINUTES } from "@/db/demo-policy";
import { previewLeave } from "./leave-preview";

const base = {
  startDate: "2026-07-06",
  endDate: "2026-07-06",
  portion: "full" as const,
  consumesBalance: true,
  unlimited: false,
  availableMinutes: 1360,
  holidays: [] as string[],
  weekendDays: [6, 7],
  workdayMinutes: DEMO_WORKDAY_MINUTES,
  today: "2026-06-15",
};

describe("previewLeave", () => {
  it("previews a future full day as a request against available", () => {
    const preview = previewLeave(base);
    expect(preview).toEqual({
      ok: true,
      intent: "request",
      thisMinutes: 480,
      availableMinutes: 1360,
      availableAfterMinutes: 880,
      otherPeriodYear: false,
    });
  });

  it("treats end on or before today as a log", () => {
    const preview = previewLeave({
      ...base,
      startDate: "2026-06-15",
      endDate: "2026-06-15",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.intent).toBe("log");
  });

  it("surfaces SPAN_CROSSES_TODAY before expansion", () => {
    const preview = previewLeave({
      ...base,
      startDate: "2026-06-01",
      endDate: "2026-06-20",
    });
    expect(preview).toMatchObject({ ok: false, code: "SPAN_CROSSES_TODAY" });
  });

  it("copies custom hours onto each working day", () => {
    const preview = previewLeave({
      ...base,
      endDate: "2026-07-08",
      portion: "custom",
      customHours: "2.67",
      incrementMinutes: null,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.thisMinutes).toBe(480);
  });

  it("rejects a non-decimal custom hours string", () => {
    expect(
      previewLeave({ ...base, portion: "custom", customHours: "two" }),
    ).toMatchObject({ ok: false, code: "INVALID_CUSTOM_HOURS" });
  });

  it("rejects negative, zero, over-workday, and off-increment custom hours", () => {
    expect(previewLeave({ ...base, portion: "custom", customHours: "-1" })).toMatchObject({
      ok: false,
      code: "INVALID_CUSTOM_HOURS",
    });
    expect(previewLeave({ ...base, portion: "custom", customHours: "0" })).toMatchObject({
      ok: false,
      code: "INVALID_CUSTOM_HOURS",
    });
    expect(
      previewLeave({ ...base, portion: "custom", customHours: "9", incrementMinutes: 60 }),
    ).toMatchObject({ ok: false, code: "MIN_INCREMENT" });
    expect(
      previewLeave({ ...base, portion: "custom", customHours: "0.5", incrementMinutes: 60 }),
    ).toMatchObject({ ok: false, code: "MIN_INCREMENT" });
  });

  it("surfaces NEGATIVE_BALANCE when available would go below the floor", () => {
    expect(
      previewLeave({ ...base, availableMinutes: 240, negativeAllowed: false }),
    ).toMatchObject({ ok: false, code: "NEGATIVE_BALANCE" });
  });

  it("does not claim this-year available after for a next-year range", () => {
    const preview = previewLeave({
      ...base,
      startDate: "2027-01-05",
      endDate: "2027-01-05",
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.otherPeriodYear).toBe(true);
    expect(preview.availableAfterMinutes).toBeNull();
  });
});

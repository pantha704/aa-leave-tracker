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
      dayCount: 1,
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
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.dayCount).toBe(3);
    expect(preview.thisMinutes).toBe(480);
  });

  it("rejects a non-decimal custom hours string", () => {
    expect(
      previewLeave({ ...base, portion: "custom", customHours: "two" }),
    ).toMatchObject({ ok: false, code: "INVALID_CUSTOM_HOURS" });
  });
});

import { describe, expect, it } from "vitest";
import { leaveFieldsFromForm } from "@/lib/leave-fields";

describe("leaveFieldsFromForm", () => {
  it("reads the log/request fields and trims the note", () => {
    const form = new FormData();
    form.set("leaveTypeId", " vacation ");
    form.set("startDate", "2026-07-06");
    form.set("endDate", "2026-07-08");
    form.set("portion", "custom");
    form.set("customHours", "2.67");
    form.set("note", "  family  ");

    expect(leaveFieldsFromForm(form)).toEqual({
      leaveTypeId: "vacation",
      startDate: "2026-07-06",
      endDate: "2026-07-08",
      portion: "custom",
      customHours: "2.67",
      note: "family",
    });
  });

  it("treats a blank note as null", () => {
    const form = new FormData();
    expect(leaveFieldsFromForm(form).note).toBeNull();
  });
});

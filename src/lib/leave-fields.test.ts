import { describe, expect, it } from "vitest";
import { leaveFieldsFromForm, ownSubmitPayload, resolveMeEmployeeId } from "@/lib/leave-fields";

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

describe("resolveMeEmployeeId", () => {
  it("is own-only: ignores another employee id even if guessed", () => {
    expect(resolveMeEmployeeId({ id: "alice" }, "bob")).toEqual({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "forbidden",
    });
    expect(resolveMeEmployeeId({ id: "alice" })).toEqual({ ok: true, employeeId: "alice" });
    expect(resolveMeEmployeeId(null)).toMatchObject({ ok: false, status: 401 });
  });
});

describe("ownSubmitPayload", () => {
  it("takes employeeId from the session actor, not FormData", () => {
    const form = new FormData();
    form.set("employeeId", "bob");
    form.set("leaveTypeId", "vacation");
    expect(ownSubmitPayload({ id: "alice" }, form).employeeId).toBe("alice");
  });
});

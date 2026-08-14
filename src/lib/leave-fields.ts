export type LeaveFormFields = {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  portion: string;
  customHours: string;
  note: string | null;
};

export function leaveFieldsFromForm(form: FormData): LeaveFormFields {
  const note = String(form.get("note") ?? "").trim();
  return {
    leaveTypeId: String(form.get("leaveTypeId") ?? "").trim(),
    startDate: String(form.get("startDate") ?? "").trim(),
    endDate: String(form.get("endDate") ?? "").trim(),
    portion: String(form.get("portion") ?? "").trim(),
    customHours: String(form.get("customHours") ?? "").trim(),
    note: note.length === 0 ? null : note,
  };
}

/** /me is own-only: ignore any guessed employeeId in the form or URL. */
export function resolveMeEmployeeId(
  actor: { id: string } | null,
  requestedEmployeeId?: string | null,
): { ok: true; employeeId: string } | { ok: false; status: 401 | 403; code: string; message: string } {
  if (!actor) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "unauthenticated" };
  }
  if (requestedEmployeeId && requestedEmployeeId !== actor.id) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "forbidden" };
  }
  return { ok: true, employeeId: actor.id };
}

export function ownSubmitPayload(actor: { id: string }, form: FormData) {
  return {
    employeeId: actor.id,
    ...leaveFieldsFromForm(form),
  };
}

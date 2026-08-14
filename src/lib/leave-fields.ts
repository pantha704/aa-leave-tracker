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

/** PTO-011: make-up time is a separate record, never a PTO ledger credit. */

export type MakeupStatus = "pending" | "approved" | "rejected" | "completed";

export type MakeupEntry = {
  id: string;
  organizationId: string;
  employeeId: string;
  missedDate: string;
  makeupDate: string;
  minutes: number;
  reason: string;
  status: MakeupStatus;
  managerId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

export function assertMakeupMinutes(minutes: number): string | null {
  if (!Number.isInteger(minutes) || minutes <= 0) return "Make-up minutes must be a positive integer.";
  return null;
}

export function createMakeupEntry(input: {
  id?: string;
  organizationId: string;
  employeeId: string;
  missedDate: string;
  makeupDate: string;
  minutes: number;
  reason: string;
  managerId?: string | null;
}): MakeupEntry | { ok: false; message: string } {
  const invalid = assertMakeupMinutes(input.minutes);
  if (invalid) return { ok: false, message: invalid };
  if (!input.reason.trim()) return { ok: false, message: "Make-up reason is required." };
  return {
    id: input.id ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    missedDate: input.missedDate,
    makeupDate: input.makeupDate,
    minutes: input.minutes,
    reason: input.reason.trim(),
    status: "pending",
    managerId: input.managerId ?? null,
    decidedBy: null,
    decidedAt: null,
  };
}

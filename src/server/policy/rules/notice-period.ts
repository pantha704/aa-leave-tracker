import { addIsoDays } from "@/lib/iso-date";
import type { Evaluation } from "../types";

export type NoticeException = "emergency" | "medical";

export function noticePeriod(input: {
  startDate: string;
  today: string;
  noticeDays: number | null | undefined;
  exception?: NoticeException | null;
}): Extract<Evaluation, { ok: false }> | null {
  const days = input.noticeDays;
  if (days == null || days <= 0) return null;
  if (input.exception === "emergency" || input.exception === "medical") return null;
  const earliest = addIsoDays(input.today, days);
  if (input.startDate >= earliest) return null;
  return {
    ok: false,
    code: "notice_period",
    message: `Requests require ${days} calendar days of notice.`,
  };
}

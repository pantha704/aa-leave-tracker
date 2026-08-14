import { requireIsoDate } from "@/server/ledger/balance";
import type { Evaluation } from "../types";

export function spanCrossesToday(input: {
  startDate: string;
  endDate: string;
  today: string;
}): Extract<Evaluation, { ok: false }> | null {
  const start = requireIsoDate(input.startDate, "startDate");
  const end = requireIsoDate(input.endDate, "endDate");
  const today = requireIsoDate(input.today, "today");
  if (start < today && today < end) {
    return {
      ok: false,
      code: "span_crosses_today",
      message: "Leave cannot start before today and end after today; file two submissions.",
    };
  }
  return null;
}

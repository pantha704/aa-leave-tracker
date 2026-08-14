/** Hours stay at the API/UI boundary; ledger and days are integer minutes. */
export function hoursToMinutes(hours: string): number {
  return Math.round(Number(hours) * 60);
}

/** Display-only. Ledger stays in integer minutes. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2);
}

export function formatDays(minutes: number, workdayMinutes: number): string {
  if (!Number.isFinite(workdayMinutes) || workdayMinutes <= 0) return "0.00";
  return (Math.round((minutes / workdayMinutes) * 100) / 100).toFixed(2);
}

export function formatUnitPair(
  minutes: number,
  workdayMinutes: number,
  legalUnit: string,
): { primary: string; secondary: string } {
  const hours = `${formatHours(minutes)}h`;
  const days = `${formatDays(minutes, workdayMinutes)}d`;
  if (legalUnit === "days") return { primary: days, secondary: hours };
  return { primary: hours, secondary: days };
}


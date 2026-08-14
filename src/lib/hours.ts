/** Display-only. Ledger stays in integer minutes. */
export function hoursToMinutes(hours: string): number {
  return Math.round(Number(hours) * 60);
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function formatHours(minutes: number): string {
  return minutesToHours(minutes).toFixed(2);
}

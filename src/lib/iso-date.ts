export const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function requireIsoDate(value: string, label = "date"): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

export function addIsoDays(isoDate: string, days: number): string {
  const [, year, month, day] = requireIsoDate(isoDate).match(ISO_DATE)!;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

export function inclusiveIsoDates(startDate: string, endDate: string): string[] {
  const start = requireIsoDate(startDate, "startDate");
  const end = requireIsoDate(endDate, "endDate");
  if (end < start) {
    throw new Error("endDate must be on or after startDate");
  }
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addIsoDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

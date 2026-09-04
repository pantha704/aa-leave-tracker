/** ABS official holidays: actual date only; no observed-day substitution. */

export function thanksgivingDate(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const weekday = first.getUTCDay();
  const firstThursday = weekday <= 4 ? 1 + (4 - weekday) : 1 + (11 - weekday);
  const day = firstThursday + 21;
  return `${year}-11-${String(day).padStart(2, "0")}`;
}

export function officialAbsHolidayDates(year: number): string[] {
  return [`${year}-01-01`, thanksgivingDate(year), `${year}-12-25`];
}

export function isOfficialAbsHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  if (!Number.isInteger(year)) return false;
  return officialAbsHolidayDates(year).includes(isoDate);
}

export type TenureBandInput = {
  minYears: number;
  maxYears: number | null;
  grantMinutes: number;
};

/** Skip leftover Add-band rows. Preview and save use this same rule. */
export function isBlankTenureBandRow(row: {
  min_years: number | string | null;
  max_years: number | string | null;
  grant_minutes: number | string | null;
}): boolean {
  return row.min_years == null && row.max_years == null && row.grant_minutes == null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = value.trim().match(ISO_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Completed years from start to asOf (hire anniversary). Invalid dates return null. */
export function tenureYears(startDate: string, asOf: string): number | null {
  const start = parseIsoDateParts(startDate);
  const on = parseIsoDateParts(asOf);
  if (!start || !on) return null;
  let years = on.year - start.year;
  if (on.month < start.month || (on.month === start.month && on.day < start.day)) {
    years -= 1;
  }
  return Math.max(0, years);
}

export function sortTenureBands<T extends { minYears: number; maxYears: number | null }>(
  bands: readonly T[],
): T[] {
  return [...bands].sort((left, right) => {
    if (left.minYears !== right.minYears) return left.minYears - right.minYears;
    if (left.maxYears == null && right.maxYears == null) return 0;
    if (left.maxYears == null) return 1;
    if (right.maxYears == null) return -1;
    return left.maxYears - right.maxYears;
  });
}

export function tenureBandMax(maxYears: number | null | undefined): number {
  return maxYears == null ? Number.POSITIVE_INFINITY : maxYears;
}

/** Inclusive ranges share at least one year. */
export function tenureBandsOverlap(
  bands: readonly { minYears: number; maxYears: number | null }[],
): boolean {
  const ordered = sortTenureBands(bands);
  for (let index = 1; index < ordered.length; index++) {
    const prev = ordered[index - 1];
    const next = ordered[index];
    if (next.minYears <= tenureBandMax(prev.maxYears)) return true;
  }
  return false;
}

/** Inclusive on both ends. Null max_years is unbounded. Lowest min_years wins. */
export function matchingTenureBand(
  bands: readonly TenureBandInput[],
  years: number,
): TenureBandInput | null {
  for (const band of sortTenureBands(bands)) {
    if (years < band.minYears) continue;
    if (band.maxYears != null && years > band.maxYears) continue;
    return band;
  }
  return null;
}

export function grantMinutesForTenure(input: {
  grantMinutes: number | null | undefined;
  tenureBands: readonly TenureBandInput[];
  startDate: string;
  asOf: string;
}): {
  tenureYears: number | null;
  grantMinutes: number | null;
  grantSource: "tenure_band" | "policy";
  band: TenureBandInput | null;
} {
  const years = tenureYears(input.startDate, input.asOf);
  if (years == null) {
    return {
      tenureYears: null,
      grantMinutes: input.grantMinutes ?? null,
      grantSource: "policy",
      band: null,
    };
  }
  const band = matchingTenureBand(input.tenureBands, years);
  if (band) {
    return {
      tenureYears: years,
      grantMinutes: band.grantMinutes,
      grantSource: "tenure_band",
      band,
    };
  }
  return {
    tenureYears: years,
    grantMinutes: input.grantMinutes ?? null,
    grantSource: "policy",
    band: null,
  };
}

export type TenureBandInput = {
  minYears: number;
  maxYears: number | null;
  grantMinutes: number;
};

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

/** Inclusive on both ends. Null max_years is unbounded. First matching row wins. */
export function matchingTenureBand(
  bands: readonly TenureBandInput[],
  years: number,
): TenureBandInput | null {
  for (const band of bands) {
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

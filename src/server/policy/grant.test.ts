import { describe, expect, it } from "vitest";
import {
  grantMinutesForTenure,
  isBlankTenureBandRow,
  matchingTenureBand,
  tenureBandsOverlap,
  tenureYears,
} from "./grant";

const bands = [
  { minYears: 0, maxYears: 4, grantMinutes: 8160 },
  { minYears: 5, maxYears: 9, grantMinutes: 9600 },
  { minYears: 10, maxYears: null, grantMinutes: 12000 },
];

describe("tenureYears", () => {
  it("counts completed anniversaries", () => {
    expect(tenureYears("2020-03-15", "2026-03-14")).toBe(5);
    expect(tenureYears("2020-03-15", "2026-03-15")).toBe(6);
    expect(tenureYears("2026-01-01", "2026-06-01")).toBe(0);
  });

  it("rejects invalid calendar dates", () => {
    expect(tenureYears("2020-02-31", "2026-01-01")).toBeNull();
    expect(tenureYears("not-a-date", "2026-01-01")).toBeNull();
  });
});

describe("matchingTenureBand", () => {
  it("uses inclusive min/max and unbounded max", () => {
    expect(matchingTenureBand(bands, 0)?.grantMinutes).toBe(8160);
    expect(matchingTenureBand(bands, 4)?.grantMinutes).toBe(8160);
    expect(matchingTenureBand(bands, 5)?.grantMinutes).toBe(9600);
    expect(matchingTenureBand(bands, 12)?.grantMinutes).toBe(12000);
  });

  it("returns null when no band matches", () => {
    expect(matchingTenureBand([{ minYears: 5, maxYears: 9, grantMinutes: 9600 }], 2)).toBeNull();
  });

  it("matches after sorting so load order does not change the grant", () => {
    const reversed = [...bands].reverse();
    expect(matchingTenureBand(reversed, 3)?.grantMinutes).toBe(8160);
    expect(matchingTenureBand(reversed, 7)?.grantMinutes).toBe(9600);
  });
});

describe("tenureBandsOverlap", () => {
  it("treats inclusive ends that share a year as overlap", () => {
    expect(
      tenureBandsOverlap([
        { minYears: 0, maxYears: 5 },
        { minYears: 5, maxYears: 10 },
      ]),
    ).toBe(true);
  });

  it("allows adjacent inclusive ranges", () => {
    expect(
      tenureBandsOverlap([
        { minYears: 0, maxYears: 4 },
        { minYears: 5, maxYears: 9 },
      ]),
    ).toBe(false);
  });
});

describe("isBlankTenureBandRow", () => {
  it("skips unused add-band rows", () => {
    expect(isBlankTenureBandRow({ min_years: null, max_years: null, grant_minutes: null })).toBe(
      true,
    );
    expect(isBlankTenureBandRow({ min_years: 0, max_years: null, grant_minutes: null })).toBe(false);
  });
});

describe("grantMinutesForTenure", () => {
  it("prefers the matching band over policy grant_minutes", () => {
    const preview = grantMinutesForTenure({
      grantMinutes: 8160,
      tenureBands: bands,
      startDate: "2014-01-01",
      asOf: "2026-06-01",
    });
    expect(preview).toEqual({
      tenureYears: 12,
      grantMinutes: 12000,
      grantSource: "tenure_band",
      band: bands[2],
    });
  });

  it("falls back to policy grant_minutes when no band matches", () => {
    const preview = grantMinutesForTenure({
      grantMinutes: 1440,
      tenureBands: [{ minYears: 10, maxYears: null, grantMinutes: 2400 }],
      startDate: "2024-01-01",
      asOf: "2026-06-01",
    });
    expect(preview.grantSource).toBe("policy");
    expect(preview.grantMinutes).toBe(1440);
    expect(preview.band).toBeNull();
  });
});

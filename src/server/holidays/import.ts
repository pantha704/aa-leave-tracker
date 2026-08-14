import { eq } from "drizzle-orm";
import { holidays } from "@/db/schema";
import { getDb } from "../db";
import {
  holidayCsvErrorsToCsv,
  holidayUniqueKey,
  parseHolidayCsv,
  type HolidayCsvError,
  type HolidayCsvRow,
} from "./csv";

export type ExistingHoliday = {
  onDate: string;
  region: string | null;
};

export type HolidayRecord = ExistingHoliday & {
  id: string;
  name: string;
};

export function collectExistingHolidayConflicts(
  rows: HolidayCsvRow[],
  existing: ExistingHoliday[],
): HolidayCsvError[] {
  const existingKeys = new Set(existing.map((row) => holidayUniqueKey(row.onDate, row.region)));
  const errors: HolidayCsvError[] = [];
  for (const row of rows) {
    if (existingKeys.has(holidayUniqueKey(row.onDate, row.region))) {
      errors.push({
        line: row.line,
        message: "duplicate (org, date, region)",
      });
    }
  }
  return errors;
}

export type HolidayImportResult =
  | { ok: true; imported: number; holidays: HolidayRecord[] }
  | { ok: false; errors: HolidayCsvError[]; errorCsv: string };

export type HolidayImportDeps = {
  loadExisting: (orgId: string) => Promise<ExistingHoliday[]>;
  insertRows: (orgId: string, rows: HolidayCsvRow[]) => Promise<HolidayRecord[]>;
};

export async function importHolidayCsv(
  orgId: string,
  csv: string,
  deps: HolidayImportDeps,
): Promise<HolidayImportResult> {
  const parsed = parseHolidayCsv(csv);
  const existing = parsed.errors.length === 0 ? await deps.loadExisting(orgId) : [];
  const errors = [...parsed.errors, ...collectExistingHolidayConflicts(parsed.rows, existing)];
  if (errors.length > 0) {
    return { ok: false, errors, errorCsv: holidayCsvErrorsToCsv(errors) };
  }

  const inserted = parsed.rows.length === 0 ? [] : await deps.insertRows(orgId, parsed.rows);
  return { ok: true, imported: inserted.length, holidays: inserted };
}

export async function loadOrgHolidays(orgId: string): Promise<HolidayRecord[]> {
  return getDb()
    .select({
      id: holidays.id,
      onDate: holidays.onDate,
      name: holidays.name,
      region: holidays.region,
    })
    .from(holidays)
    .where(eq(holidays.orgId, orgId))
    .orderBy(holidays.onDate, holidays.name);
}

export async function insertOrgHolidays(
  orgId: string,
  rows: HolidayCsvRow[],
): Promise<HolidayRecord[]> {
  return getDb()
    .insert(holidays)
    .values(
      rows.map((row) => ({
        orgId,
        onDate: row.onDate,
        name: row.name,
        region: row.region,
      })),
    )
    .returning({
      id: holidays.id,
      onDate: holidays.onDate,
      name: holidays.name,
      region: holidays.region,
    });
}

export const dbHolidayImportDeps: HolidayImportDeps = {
  loadExisting: loadOrgHolidays,
  insertRows: insertOrgHolidays,
};

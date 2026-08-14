import { and, eq } from "drizzle-orm";
import { holidays } from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "../audit";
import { getDb } from "../db";
import { APP_READONLY_CODE, APP_READONLY_MESSAGE, isAppReadonly } from "../settings";
import { isUniqueViolation } from "../pg-error";
import {
  holidayCsvErrorsToCsv,
  holidayUniqueKey,
  parseHolidayCsv,
  type HolidayCsvError,
  type HolidayCsvRow,
} from "./csv";

export type HolidayImportMode = "insert" | "upsert";

export type ExistingHoliday = {
  id?: string;
  onDate: string;
  name?: string;
  region: string | null;
};

export type HolidayRecord = {
  id: string;
  onDate: string;
  name: string;
  region: string | null;
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
  | { ok: true; imported: number; updated: number; holidays: HolidayRecord[] }
  | { ok: false; errors: HolidayCsvError[]; errorCsv: string }
  | { ok: false; status: 423; code: typeof APP_READONLY_CODE; error: string };

export type HolidayApplyResult =
  | { ok: true; imported: number; updated: number; holidays: HolidayRecord[] }
  | { ok: false; errors: HolidayCsvError[] };

export type HolidayImportDeps = {
  apply: (orgId: string, rows: HolidayCsvRow[], mode: HolidayImportMode) => Promise<HolidayApplyResult>;
  isAppReadonly?: (orgId: string) => Promise<boolean>;
};

export type HolidayImportOptions = {
  mode?: HolidayImportMode;
  actorId?: string | null;
  writeAudit?: AuditWriter;
};

function fail(errors: HolidayCsvError[]): HolidayImportResult {
  return { ok: false, errors, errorCsv: holidayCsvErrorsToCsv(errors) };
}

export async function importHolidayCsv(
  orgId: string,
  csv: string,
  deps: HolidayImportDeps,
  options: HolidayImportOptions = {},
): Promise<HolidayImportResult> {
  if (await (deps.isAppReadonly ?? (async () => false))(orgId)) {
    return { ok: false, status: 423, code: APP_READONLY_CODE, error: APP_READONLY_MESSAGE };
  }
  const mode = options.mode ?? "insert";
  const parsed = parseHolidayCsv(csv);
  if (parsed.errors.length > 0) {
    return fail(parsed.errors);
  }

  let applied: HolidayApplyResult;
  try {
    applied = await deps.apply(orgId, parsed.rows, mode);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail(
        parsed.rows.map((row) => ({
          line: row.line,
          message: "duplicate (org, date, region)",
        })),
      );
    }
    throw err;
  }

  if (!applied.ok) {
    return fail(applied.errors);
  }

  await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
    actorId: options.actorId ?? null,
    action: "holiday.import",
    entityType: "organization",
    entityId: orgId,
    after: { imported: applied.imported, updated: applied.updated, mode },
  });

  return applied;
}

const holidayReturning = {
  id: holidays.id,
  onDate: holidays.onDate,
  name: holidays.name,
  region: holidays.region,
};

export async function loadOrgHolidays(orgId: string): Promise<HolidayRecord[]> {
  return getDb()
    .select(holidayReturning)
    .from(holidays)
    .where(eq(holidays.orgId, orgId))
    .orderBy(holidays.onDate, holidays.name);
}

export async function applyHolidayRows(
  orgId: string,
  rows: HolidayCsvRow[],
  mode: HolidayImportMode,
): Promise<HolidayApplyResult> {
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select(holidayReturning)
      .from(holidays)
      .where(eq(holidays.orgId, orgId));

    if (mode === "insert") {
      const conflicts = collectExistingHolidayConflicts(rows, existing);
      if (conflicts.length > 0) {
        return { ok: false, errors: conflicts };
      }
      if (rows.length === 0) {
        return { ok: true, imported: 0, updated: 0, holidays: [] };
      }
      const inserted = await tx
        .insert(holidays)
        .values(
          rows.map((row) => ({
            orgId,
            onDate: row.onDate,
            name: row.name,
            region: row.region,
          })),
        )
        .returning(holidayReturning);
      return { ok: true, imported: inserted.length, updated: 0, holidays: inserted };
    }

    const byKey = new Map(existing.map((row) => [holidayUniqueKey(row.onDate, row.region), row]));
    const toInsert: HolidayCsvRow[] = [];
    const toUpdate: HolidayRecord[] = [];
    for (const row of rows) {
      const hit = byKey.get(holidayUniqueKey(row.onDate, row.region));
      if (hit) {
        toUpdate.push({ ...hit, name: row.name });
      } else {
        toInsert.push(row);
      }
    }

    const updated: HolidayRecord[] = [];
    for (const row of toUpdate) {
      const [next] = await tx
        .update(holidays)
        .set({ name: row.name })
        .where(and(eq(holidays.id, row.id), eq(holidays.orgId, orgId)))
        .returning(holidayReturning);
      if (next) updated.push(next);
    }

    const inserted =
      toInsert.length === 0
        ? []
        : await tx
            .insert(holidays)
            .values(
              toInsert.map((row) => ({
                orgId,
                onDate: row.onDate,
                name: row.name,
                region: row.region,
              })),
            )
            .returning(holidayReturning);

    return {
      ok: true,
      imported: inserted.length,
      updated: updated.length,
      holidays: [...updated, ...inserted],
    };
  });
}

export async function deleteHoliday(
  orgId: string,
  id: string,
  options: {
    actorId?: string | null;
    writeAudit?: AuditWriter;
    isAppReadonly?: (orgId: string) => Promise<boolean>;
  } = {},
): Promise<{ ok: true } | { ok: false; error: string; status: 404 | 423; code?: string }> {
  if (await (options.isAppReadonly ?? isAppReadonly)(orgId)) {
    return { ok: false, status: 423, code: APP_READONLY_CODE, error: APP_READONLY_MESSAGE };
  }
  const deleted = await getDb()
    .delete(holidays)
    .where(and(eq(holidays.id, id), eq(holidays.orgId, orgId)))
    .returning({ id: holidays.id, onDate: holidays.onDate, region: holidays.region });
  if (deleted.length === 0) {
    return { ok: false, status: 404, error: "holiday not found" };
  }
  await tryWriteAudit(options.writeAudit ?? writeAuditEvent, {
    actorId: options.actorId ?? null,
    action: "holiday.delete",
    entityType: "holiday",
    entityId: id,
    before: deleted[0],
  });
  return { ok: true };
}

export const dbHolidayImportDeps: HolidayImportDeps = {
  apply: applyHolidayRows,
  isAppReadonly,
};

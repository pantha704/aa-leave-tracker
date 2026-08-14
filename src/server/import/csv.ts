import { parseCsvRecords, parseIsoDate, type CsvRecord } from "@/server/holidays/csv";

export const IMPORT_OPENING_REASON = "import: opening remaining";

export type ImportKind = "opening" | "entries";

export const OPENING_FIELDS = [
  "email",
  "leave_type",
  "as_of",
  "granted_hours",
  "used_hours",
  "remaining_hours",
  "notes",
] as const;

export const ENTRY_FIELDS = [
  "email",
  "leave_type",
  "start",
  "end",
  "hours",
  "portion",
  "note",
  "status",
] as const;

export type OpeningField = (typeof OPENING_FIELDS)[number];
export type EntryField = (typeof ENTRY_FIELDS)[number];
export type ImportField = OpeningField | EntryField;

/** Mapping a column to these targets would write grant_lump. Forbidden. */
export const GRANT_MAP_TARGETS = new Set([
  "grant",
  "grant_lump",
  "allotment",
  "lump",
  "lump_sum",
  "opening_grant",
]);

const DECIMAL_HOURS = /^-?\d+(\.\d+)?$/;
const PORTIONS = new Set(["full", "am", "pm", "custom"]);

export type ColumnMap = Record<string, string | number | null | undefined>;

export type ImportCsvError = {
  line: number;
  message: string;
  field?: string;
  code?: string;
};

export type MappedOpeningRow = {
  line: number;
  email: string;
  leaveType: string;
  asOf: string;
  grantedHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
  notes: string | null;
};

export type MappedEntryRow = {
  line: number;
  email: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  portion: "full" | "am" | "pm" | "custom";
  note: string | null;
  status: string | null;
};

export type MapCsvResult =
  | {
      ok: true;
      kind: "opening";
      headers: string[];
      rows: MappedOpeningRow[];
      errors: ImportCsvError[];
      warnings: ImportCsvError[];
    }
  | {
      ok: true;
      kind: "entries";
      headers: string[];
      rows: MappedEntryRow[];
      errors: ImportCsvError[];
      warnings: ImportCsvError[];
    }
  | { ok: false; kind: ImportKind; headers: string[]; errors: ImportCsvError[] };

export function normalizeImportHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

export function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function parseHoursCell(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!DECIMAL_HOURS.test(trimmed) || !Number.isFinite(Number(trimmed))) return null;
  return Number(trimmed);
}

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function importErrorsToCsv(errors: ImportCsvError[]): string {
  const lines = ["line,field,message"];
  for (const error of errors) {
    lines.push(`${error.line},${csvEscape(error.field ?? "")},${csvEscape(error.message)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function fieldsForKind(kind: ImportKind): readonly ImportField[] {
  return kind === "opening" ? OPENING_FIELDS : ENTRY_FIELDS;
}

export function requiredFieldsForKind(kind: ImportKind): readonly ImportField[] {
  return kind === "opening" ? ["email", "leave_type", "as_of"] : ["email", "leave_type", "start", "end"];
}

export function grantMapTargets(map: ColumnMap): string[] {
  return Object.keys(map).filter((key) => GRANT_MAP_TARGETS.has(normalizeImportHeader(key)));
}

/** Suggestions only. Parse never applies these unless the caller puts them in `map`. */
export function suggestImportMap(headers: string[], kind: ImportKind): ColumnMap {
  const aliases: Record<string, string[]> = {
    email: ["email", "e_mail", "work_email", "employee_email"],
    leave_type: ["leave_type", "type", "leave", "leave_type_code", "code"],
    as_of: ["as_of", "asof", "effective_on", "date"],
    granted_hours: ["granted_hours", "granted", "grant_hours"],
    used_hours: ["used_hours", "used", "taken_hours", "taken"],
    remaining_hours: ["remaining_hours", "remaining", "balance", "balance_hours"],
    notes: ["notes", "note", "comment"],
    start: ["start", "start_date", "from"],
    end: ["end", "end_date", "to"],
    hours: ["hours", "total_hours"],
    portion: ["portion", "day_portion"],
    status: ["status"],
  };
  const normalized = headers.map(normalizeImportHeader);
  const map: ColumnMap = {};
  for (const field of fieldsForKind(kind)) {
    const wanted = aliases[field] ?? [field];
    const idx = normalized.findIndex((header) => wanted.includes(header));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}

export function resolveMappedIndex(
  headers: string[],
  spec: string | number | null | undefined,
): number | null {
  if (spec == null || spec === "") return null;
  if (typeof spec === "number") {
    if (!Number.isInteger(spec) || spec < 0 || spec >= headers.length) return null;
    return spec;
  }
  const trimmed = spec.trim();
  if (!trimmed) return null;
  const asIndex = Number(trimmed);
  if (/^\d+$/.test(trimmed) && Number.isInteger(asIndex) && asIndex >= 0 && asIndex < headers.length) {
    return asIndex;
  }
  const exact = headers.findIndex((header) => header === trimmed);
  if (exact >= 0) return exact;
  const want = normalizeImportHeader(trimmed);
  const fuzzy = headers.findIndex((header) => normalizeImportHeader(header) === want);
  return fuzzy >= 0 ? fuzzy : null;
}

export function validateColumnMap(
  headers: string[],
  map: ColumnMap,
  kind: ImportKind,
): ImportCsvError[] {
  const errors: ImportCsvError[] = [];
  const grants = grantMapTargets(map);
  if (grants.length > 0) {
    errors.push({
      line: 1,
      field: grants[0],
      code: "GRANT_MAP",
      message: "import must not map a grant column; opening remaining is adjustment only",
    });
  }
  for (const field of requiredFieldsForKind(kind)) {
    if (map[field] == null || map[field] === "") {
      errors.push({
        line: 1,
        field,
        code: "UNMAPPED",
        message: `map ${field} to a CSV column (headers are not assumed)`,
      });
      continue;
    }
    if (resolveMappedIndex(headers, map[field]) == null) {
      errors.push({
        line: 1,
        field,
        code: "BAD_MAP",
        message: `column for ${field} not found: ${String(map[field])}`,
      });
    }
  }
  return errors;
}

function cell(record: CsvRecord, index: number | null): string {
  if (index == null) return "";
  return record.cells[index] ?? "";
}

export function remainingFromOpening(input: {
  grantedHours: number | null;
  usedHours: number | null;
  remainingHours: number | null;
}):
  | { ok: true; minutes: number; source: "granted_minus_used" | "remaining_only"; dataLoss: boolean }
  | { ok: false; error: string } {
  const fromGranted =
    input.grantedHours != null && input.usedHours != null
      ? hoursToMinutes(input.grantedHours - input.usedHours)
      : null;
  const fromRemaining = input.remainingHours != null ? hoursToMinutes(input.remainingHours) : null;
  if (fromGranted != null && fromRemaining != null && fromGranted !== fromRemaining) {
    return {
      ok: false,
      error: `granted−used (${fromGranted} min) disagrees with remaining (${fromRemaining} min)`,
    };
  }
  if (fromGranted != null) {
    return {
      ok: true,
      minutes: fromGranted,
      source: "granted_minus_used",
      dataLoss: false,
    };
  }
  if (fromRemaining != null) {
    return {
      ok: true,
      minutes: fromRemaining,
      source: "remaining_only",
      dataLoss: true,
    };
  }
  if (input.grantedHours != null) {
    return {
      ok: false,
      error: "granted hours without used hours cannot become a grant; map used or remaining",
    };
  }
  return { ok: false, error: "map remaining_hours or both granted_hours and used_hours" };
}

export function mapImportCsv(csv: string, kind: ImportKind, map: ColumnMap): MapCsvResult {
  const records = parseCsvRecords(csv);
  if (records.length === 0) {
    return { ok: false, kind, headers: [], errors: [{ line: 1, message: "missing header row" }] };
  }

  const headers = records[0].cells.map((cell) => cell.replace(/^\uFEFF/, ""));
  const mapErrors = validateColumnMap(headers, map, kind);
  if (mapErrors.length > 0) {
    return { ok: false, kind, headers, errors: mapErrors };
  }

  const idx = (field: string) => resolveMappedIndex(headers, map[field]);

  if (kind === "opening") {
    const emailI = idx("email");
    const typeI = idx("leave_type");
    const asOfI = idx("as_of");
    const grantedI = idx("granted_hours");
    const usedI = idx("used_hours");
    const remainingI = idx("remaining_hours");
    const notesI = idx("notes");
    const rows: MappedOpeningRow[] = [];
    const errors: ImportCsvError[] = [];
    const warnings: ImportCsvError[] = [];

    for (const record of records.slice(1)) {
      const line = record.line;
      const email = cell(record, emailI).trim();
      const leaveType = cell(record, typeI).trim();
      const asOfRaw = cell(record, asOfI);
      const asOf = parseIsoDate(asOfRaw);
      const grantedRaw = cell(record, grantedI);
      const usedRaw = cell(record, usedI);
      const remainingRaw = cell(record, remainingI);
      const grantedHours = grantedI == null ? null : parseHoursCell(grantedRaw);
      const usedHours = usedI == null ? null : parseHoursCell(usedRaw);
      const remainingHours = remainingI == null ? null : parseHoursCell(remainingRaw);

      if (!email) errors.push({ line, field: "email", message: "email is required" });
      if (!leaveType) errors.push({ line, field: "leave_type", message: "leave_type is required" });
      if (!asOf) {
        errors.push({ line, field: "as_of", message: `invalid date: ${asOfRaw.trim() || "(empty)"}` });
      }
      if (grantedI != null && grantedRaw.trim() && grantedHours == null) {
        errors.push({ line, field: "granted_hours", message: `invalid hours: ${grantedRaw.trim()}` });
      }
      if (usedI != null && usedRaw.trim() && usedHours == null) {
        errors.push({ line, field: "used_hours", message: `invalid hours: ${usedRaw.trim()}` });
      }
      if (remainingI != null && remainingRaw.trim() && remainingHours == null) {
        errors.push({ line, field: "remaining_hours", message: `invalid hours: ${remainingRaw.trim()}` });
      }
      if (!email || !leaveType || !asOf) continue;

      const remaining = remainingFromOpening({ grantedHours, usedHours, remainingHours });
      if (!remaining.ok) {
        errors.push({ line, field: "remaining_hours", message: remaining.error });
        continue;
      }
      if (remaining.dataLoss) {
        warnings.push({
          line,
          field: "remaining_hours",
          code: "DATA_LOSS",
          message:
            grantedHours != null
              ? "granted without used; using remaining_hours only"
              : "remaining-only row; granted/used detail unknown",
        });
      }

      rows.push({
        line,
        email,
        leaveType,
        asOf,
        grantedHours,
        usedHours,
        remainingHours,
        notes: cell(record, notesI).trim() || null,
      });
    }

    return { ok: true, kind, headers, rows, errors, warnings };
  }

  const emailI = idx("email");
  const typeI = idx("leave_type");
  const startI = idx("start");
  const endI = idx("end");
  const hoursI = idx("hours");
  const portionI = idx("portion");
  const noteI = idx("note");
  const statusI = idx("status");
  const rows: MappedEntryRow[] = [];
  const errors: ImportCsvError[] = [];

  for (const record of records.slice(1)) {
    const line = record.line;
    const email = cell(record, emailI).trim();
    const leaveType = cell(record, typeI).trim();
    const startRaw = cell(record, startI);
    const endRaw = cell(record, endI);
    const startDate = parseIsoDate(startRaw);
    const endDate = parseIsoDate(endRaw);
    const hoursRaw = cell(record, hoursI);
    const hours = hoursI == null ? null : parseHoursCell(hoursRaw);
    const portionRaw = cell(record, portionI).trim().toLowerCase();
    const portion = PORTIONS.has(portionRaw)
      ? (portionRaw as MappedEntryRow["portion"])
      : hours != null
        ? "custom"
        : "full";

    if (!email) errors.push({ line, field: "email", message: "email is required" });
    if (!leaveType) errors.push({ line, field: "leave_type", message: "leave_type is required" });
    if (!startDate) {
      errors.push({ line, field: "start", message: `invalid date: ${startRaw.trim() || "(empty)"}` });
    }
    if (!endDate) {
      errors.push({ line, field: "end", message: `invalid date: ${endRaw.trim() || "(empty)"}` });
    }
    if (startDate && endDate && endDate < startDate) {
      errors.push({ line, field: "end", message: "end must be on or after start" });
    }
    if (hoursI != null && hoursRaw.trim() && hours == null) {
      errors.push({ line, field: "hours", message: `invalid hours: ${hoursRaw.trim()}` });
    }
    if (portionI != null && portionRaw && !PORTIONS.has(portionRaw)) {
      errors.push({ line, field: "portion", message: `invalid portion: ${portionRaw}` });
    }
    if (!email || !leaveType || !startDate || !endDate || (endDate && startDate && endDate < startDate)) {
      continue;
    }

    rows.push({
      line,
      email,
      leaveType,
      startDate,
      endDate,
      hours,
      portion,
      note: cell(record, noteI).trim() || null,
      status: cell(record, statusI).trim() || null,
    });
  }

  return { ok: true, kind, headers, rows, errors, warnings: [] };
}

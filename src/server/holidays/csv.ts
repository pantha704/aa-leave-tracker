export type HolidayCsvRow = {
  line: number;
  onDate: string;
  name: string;
  region: string | null;
};

export type HolidayCsvError = {
  line: number;
  message: string;
  field?: string;
};

export type HolidayCsvParseResult = {
  rows: HolidayCsvRow[];
  errors: HolidayCsvError[];
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DATE_HEADERS = new Set(["date", "on_date", "ondate", "holiday_date", "holidaydate"]);
const NAME_HEADERS = new Set(["name", "holiday", "holiday_name", "holidayname", "title"]);
const REGION_HEADERS = new Set(["region", "location", "country"]);

export function normalizeHolidayHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizeHolidayRegion(region: string | null | undefined): string | null {
  const trimmed = region?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/** Matches unique index holidays_org_date_region: (org, date, COALESCE(region, '')). */
export function holidayUniqueKey(onDate: string, region: string | null | undefined): string {
  return `${onDate}\t${normalizeHolidayRegion(region) ?? ""}`;
}

export function parseIsoDate(value: string): string | null {
  const match = value.trim().match(ISO_DATE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export type CsvRecord = {
  line: number;
  cells: string[];
};

export function parseCsvRecords(text: string): CsvRecord[] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let line = 1;
  let recordLine = 1;

  const flushRecord = () => {
    if (row.some((cell) => cell.trim().length > 0)) {
      records.push({ line: recordLine, cells: row });
    }
    row = [];
    field = "";
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      flushRecord();
      line += 1;
      recordLine = line;
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes || field.length > 0 || row.length > 0) {
    row.push(field);
    flushRecord();
  }

  return records;
}

export type HolidayHeaderMap = {
  date: number;
  name: number;
  region: number | null;
};

export function mapHolidayHeaders(headers: string[]): HolidayHeaderMap | { error: string } {
  const normalized = headers.map(normalizeHolidayHeader);
  const date = normalized.findIndex((h) => DATE_HEADERS.has(h));
  const name = normalized.findIndex((h) => NAME_HEADERS.has(h));
  const regionIdx = normalized.findIndex((h) => REGION_HEADERS.has(h));

  if (date < 0 && name < 0) {
    return { error: "header must include date and name columns" };
  }
  if (date < 0) {
    return { error: "header must include a date column" };
  }
  if (name < 0) {
    return { error: "header must include a name column" };
  }

  return { date, name, region: regionIdx >= 0 ? regionIdx : null };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function holidayCsvErrorsToCsv(errors: HolidayCsvError[]): string {
  const lines = ["line,message"];
  for (const error of errors) {
    lines.push(`${error.line},${csvEscape(error.message)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseHolidayCsv(text: string): HolidayCsvParseResult {
  const records = parseCsvRecords(text);
  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, message: "missing header row" }] };
  }

  const mapped = mapHolidayHeaders(records[0].cells);
  if ("error" in mapped) {
    return { rows: [], errors: [{ line: records[0].line, message: mapped.error }] };
  }

  const rows: HolidayCsvRow[] = [];
  const errors: HolidayCsvError[] = [];
  const seen = new Map<string, number>();

  for (const record of records.slice(1)) {
    const line = record.line;
    const cells = record.cells;
    const rawDate = cells[mapped.date] ?? "";
    const rawName = cells[mapped.name] ?? "";
    const rawRegion = mapped.region == null ? "" : (cells[mapped.region] ?? "");

    const onDate = parseIsoDate(rawDate);
    const name = rawName.trim();
    const region = normalizeHolidayRegion(rawRegion);

    if (!onDate) {
      errors.push({ line, field: "date", message: `invalid date: ${rawDate.trim() || "(empty)"}` });
    }
    if (!name) {
      errors.push({ line, field: "name", message: "name is required" });
    }
    if (!onDate || !name) continue;

    const key = holidayUniqueKey(onDate, region);
    const firstLine = seen.get(key);
    if (firstLine != null) {
      errors.push({
        line,
        message: `duplicate (org, date, region) of line ${firstLine}`,
      });
      continue;
    }
    seen.set(key, line);
    rows.push({ line, onDate, name, region });
  }

  return { rows, errors };
}

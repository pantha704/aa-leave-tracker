export function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Neutralize Excel/Sheets formula injection on text cells (`=`, `+`, `-`, `@`, tab, CR). */
export function neutralizeCsvFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function csvEscape(value: string): string {
  const cell = neutralizeCsvFormula(value);
  if (/[",\n\r]/.test(cell) || cell !== value) {
    return `"${cell.replaceAll('"', '""')}"`;
  }
  return cell;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  return csvEscape(value);
}

export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function csvHeaderColumns(csv: string): string[] {
  const first = csv.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  return first.split(",");
}

export function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  return csvEscape(String(value));
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

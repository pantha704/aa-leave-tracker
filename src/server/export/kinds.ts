export const EXPORT_KINDS = ["balances", "entries", "ledger", "termination"] as const;

export type ExportKind = (typeof EXPORT_KINDS)[number];

export function parseExportKind(raw: string): ExportKind | null {
  const kind = raw.trim().toLowerCase().replace(/\.csv$/i, "");
  return (EXPORT_KINDS as readonly string[]).includes(kind) ? (kind as ExportKind) : null;
}

export function exportFilename(kind: ExportKind, asOf: string): string {
  return `${kind}-${asOf}.csv`;
}

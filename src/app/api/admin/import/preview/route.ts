import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import type { ColumnMap, ImportKind } from "@/server/import/csv";
import { dbImportStore, previewImport, type ImportCommitStore } from "@/server/import/commit";
import type { DryRunResult } from "@/server/import/dry-run";

export type AdminImportPreviewDeps = AdminGateDeps & {
  preview: (
    orgId: string,
    kind: ImportKind,
    csv: string,
    map: ColumnMap,
    store: ImportCommitStore,
  ) => Promise<DryRunResult>;
  store: ImportCommitStore;
};

const defaultDeps: AdminImportPreviewDeps = {
  ...defaultAdminGateDeps,
  preview: previewImport,
  store: dbImportStore,
};

export function parseImportKind(value: unknown): ImportKind | null {
  return value === "opening" || value === "entries" ? value : null;
}

export function parseColumnMap(value: unknown): ColumnMap {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return {};
  const map: ColumnMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" || typeof raw === "number" || raw == null) {
      map[key] = raw;
    }
  }
  return map;
}

export async function postAdminImportPreview(
  request: NextRequest,
  deps: AdminImportPreviewDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const record = body.value as Record<string, unknown>;
  const kind = parseImportKind(record.kind);
  const csv = typeof record.csv === "string" ? record.csv : null;
  if (!kind) return NextResponse.json({ error: "kind must be opening or entries" }, { status: 400 });
  if (csv == null) return NextResponse.json({ error: "csv is required" }, { status: 400 });

  const result = await deps.preview(gate.context.orgId, kind, csv, parseColumnMap(record.map), deps.store);
  if (!result.ok) {
    return NextResponse.json(
      { error: "csv_errors", ...result },
      { status: 400 },
    );
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  return postAdminImportPreview(request);
}

"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import type { ColumnMap, ImportKind } from "@/server/import/csv";
import { parseCsvRecords } from "@/server/holidays/csv";
import {
  commitImport,
  dbImportStore,
  previewImport,
  reverseImportBatch,
} from "@/server/import/commit";
import type { DryRunResult } from "@/server/import/dry-run";

export type ImportFormState =
  | {
      ok: true;
      step: "mapped";
      kind: ImportKind;
      filename: string;
      csv: string;
      headers: string[];
    }
  | {
      ok: true;
      step: "preview";
      kind: ImportKind;
      filename: string;
      csv: string;
      headers: string[];
      map: ColumnMap;
      preview: DryRunResult;
    }
  | {
      ok: true;
      step: "committed";
      kind: ImportKind;
      csv: string;
      posted: number;
      entries: number;
      batchId: string;
    }
  | { ok: false; error: string; csv?: string; preview?: DryRunResult }
  | undefined;

export type ReverseFormState = { ok: true } | { ok: false; error: string } | undefined;

function asKind(value: FormDataEntryValue | null): ImportKind {
  return value === "entries" ? "entries" : "opening";
}

function mapFromForm(formData: FormData, kind: ImportKind): ColumnMap {
  const prefix = "map_";
  const map: ColumnMap = {};
  const fields =
    kind === "opening"
      ? ["email", "leave_type", "as_of", "granted_hours", "used_hours", "remaining_hours", "notes"]
      : ["email", "leave_type", "start", "end", "hours", "portion", "note", "status"];
  for (const field of fields) {
    const raw = String(formData.get(`${prefix}${field}`) ?? "").trim();
    if (raw) map[field] = raw;
  }
  return map;
}

export async function parseImportHeadersAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file" };
  }
  const csv = await file.text();
  const records = parseCsvRecords(csv);
  if (records.length === 0) {
    return { ok: false, error: "missing header row" };
  }
  return {
    ok: true,
    step: "mapped",
    kind: asKind(formData.get("kind")),
    filename: file.name,
    csv,
    headers: records[0].cells.map((cell) => cell.replace(/^\uFEFF/, "")),
  };
}

export async function previewImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { employee } = await requireAdmin();
  const kind = asKind(formData.get("kind"));
  const csv = String(formData.get("csv") ?? "");
  const filename = String(formData.get("filename") ?? "import.csv");
  const headers = String(formData.get("headers") ?? "")
    .split("\u0001")
    .filter((header) => header.length > 0);
  if (!csv) return { ok: false, error: "CSV is required" };

  const map = mapFromForm(formData, kind);
  const preview = await previewImport(employee.orgId, kind, csv, map, dbImportStore);
  return {
    ok: true,
    step: "preview",
    kind,
    filename,
    csv,
    headers,
    map,
    preview,
  };
}

export async function commitImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { employee } = await requireAdmin();
  const kind = asKind(formData.get("kind"));
  const csv = String(formData.get("csv") ?? "");
  const filename = String(formData.get("filename") ?? "import.csv");
  if (!csv) return { ok: false, error: "CSV is required" };

  const result = await commitImport(
    {
      orgId: employee.orgId,
      actor: { id: employee.id, role: "admin" },
      kind,
      csv,
      map: mapFromForm(formData, kind),
      filename,
    },
    dbImportStore,
  );
  if (!result.ok) {
    if ("status" in result) {
      return { ok: false, error: result.error, csv };
    }
    return {
      ok: false,
      error: `${result.dryRun.errors.length} row error(s)`,
      csv,
      preview: result.dryRun,
    };
  }
  revalidatePath("/admin/import");
  return {
    ok: true,
    step: "committed",
    kind,
    csv,
    posted: result.posted,
    entries: result.entries,
    batchId: result.batch.id,
  };
}

export async function reverseImportAction(
  _prev: ReverseFormState,
  formData: FormData,
): Promise<ReverseFormState> {
  const { employee } = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) return { ok: false, error: "import batch is required" };
  const result = await reverseImportBatch(
    { orgId: employee.orgId, batchId, actor: { id: employee.id, role: "admin" } },
    dbImportStore,
  );
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/admin/import");
  return { ok: true };
}

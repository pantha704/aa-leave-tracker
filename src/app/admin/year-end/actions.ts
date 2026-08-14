"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth";
import {
  closeYear,
  openFirstYear,
  previewCloseYear,
  reopenYear,
  type ClosePreviewRow,
} from "@/server/year-end";

export type YearEndFormState =
  | { ok: true; kind: "preview"; year: number; rows: ClosePreviewRow[] }
  | { ok: true; kind: "closed"; year: number; snapshotPath: string }
  | { ok: true; kind: "reopened"; year: number; reversed: number }
  | { ok: true; kind: "opened"; year: number; posts: number }
  | { ok: false; error: string }
  | undefined;

function parseYear(formData: FormData): number | null {
  const raw = Number(String(formData.get("year") ?? ""));
  if (!Number.isInteger(raw) || raw < 2000 || raw > 2100) return null;
  return raw;
}

function refresh() {
  revalidatePath("/admin/year-end");
}

export async function previewCloseAction(
  _prev: YearEndFormState,
  formData: FormData,
): Promise<YearEndFormState> {
  const { employee } = await requireAdmin();
  const year = parseYear(formData);
  if (year == null) return { ok: false, error: "year must be a calendar year" };
  const result = await previewCloseYear(employee.orgId, year, {
    acknowledgeForfeit: formData.get("acknowledge_forfeit") === "on",
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, kind: "preview", year, rows: result.plan.preview };
}

export async function closeYearAction(
  _prev: YearEndFormState,
  formData: FormData,
): Promise<YearEndFormState> {
  const { employee } = await requireAdmin();
  const year = parseYear(formData);
  if (year == null) return { ok: false, error: "year must be a calendar year" };
  const result = await closeYear(employee.orgId, year, employee.id, {
    acknowledgeForfeit: formData.get("acknowledge_forfeit") === "on",
  });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return {
    ok: true,
    kind: "closed",
    year,
    snapshotPath: result.snapshot?.path ?? "",
  };
}

export async function reopenYearAction(
  _prev: YearEndFormState,
  formData: FormData,
): Promise<YearEndFormState> {
  const { employee } = await requireAdmin();
  const year = parseYear(formData);
  if (year == null) return { ok: false, error: "year must be a calendar year" };
  const result = await reopenYear(employee.orgId, year, employee.id);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, kind: "reopened", year, reversed: result.reversed ?? 0 };
}

export async function openFirstYearAction(
  _prev: YearEndFormState,
  formData: FormData,
): Promise<YearEndFormState> {
  const { employee } = await requireAdmin();
  const year = parseYear(formData);
  if (year == null) return { ok: false, error: "year must be a calendar year" };
  const result = await openFirstYear(employee.orgId, year, employee.id);
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, kind: "opened", year, posts: result.posts ?? 0 };
}

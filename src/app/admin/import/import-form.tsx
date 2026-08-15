"use client";

import { useActionState } from "react";
import { formatHours } from "@/lib/hours";
import {
  ENTRY_FIELDS,
  OPENING_FIELDS,
  suggestImportMap,
  type ColumnMap,
  type ImportField,
  type ImportKind,
} from "@/server/import/csv";
import type { DryRunResult } from "@/server/import/dry-run";
import { commitImportAction, parseImportHeadersAction, previewImportAction } from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const buttonClass =
  "w-fit rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

export function LeaveImportForm({ appReadonly = false }: { appReadonly?: boolean }) {
  const [headersState, parseAction, parsePending] = useActionState(parseImportHeadersAction, undefined);
  const [previewState, previewAction, previewPending] = useActionState(previewImportAction, undefined);
  const [commitState, commitAction, commitPending] = useActionState(commitImportAction, undefined);

  const mapped = headersState && headersState.ok && headersState.step === "mapped" ? headersState : null;
  const uploadKey = mapped ? `${mapped.kind}:${mapped.filename}:${mapped.csv}` : "";
  const preview =
    previewState &&
    previewState.ok &&
    previewState.step === "preview" &&
    mapped &&
    previewState.csv === mapped.csv &&
    previewState.kind === mapped.kind
      ? previewState
      : null;
  const committed =
    commitState && commitState.ok && commitState.step === "committed" && commitState.csv === mapped?.csv
      ? commitState
      : null;
  const failed =
    commitState && !commitState.ok && (!mapped || !commitState.csv || commitState.csv === mapped.csv)
      ? commitState
      : null;
  const kind: ImportKind = mapped?.kind ?? "opening";
  const headers = mapped?.headers ?? [];
  const csv = mapped?.csv ?? "";
  const filename = mapped?.filename ?? "";
  const fields: readonly ImportField[] = kind === "opening" ? OPENING_FIELDS : ENTRY_FIELDS;
  const suggestions = mapped ? suggestImportMap(mapped.headers, mapped.kind) : {};
  const dryRun = failed?.preview ?? preview?.preview;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <form action={parseAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Kind
          <select className={fieldClass} name="kind" defaultValue="opening">
            <option value="opening">Opening remaining</option>
            <option value="entries">Historical entries</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          CSV
          <input className={fieldClass} type="file" name="file" accept=".csv,text/csv" required />
        </label>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Headers are not assumed. After upload, map each field to a column. Opening remaining posts
          sheet − app (adjustment only). Import opening or same-year used days, not both.
        </p>
        <button className={buttonClass} type="submit" disabled={parsePending}>
          Read headers
        </button>
      </form>

      {mapped ? (
        <form key={`map-${uploadKey}`} action={previewAction} className="flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="csv" value={csv} />
          <input type="hidden" name="filename" value={filename} />
          <input type="hidden" name="headers" value={headers.join("\u0001")} />
          <h2 className="text-lg font-medium">Column map</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field} className="flex flex-col gap-1 text-xs">
                {field}
                <select className={fieldClass} name={`map_${field}`} defaultValue={mappedValue(suggestions, field)}>
                  <option value="">(unmapped)</option>
                  {headers.map((header) => (
                    <option key={`${field}-${header}`} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button className={buttonClass} type="submit" disabled={previewPending}>
            Dry-run
          </button>
        </form>
      ) : null}

      {dryRun ? <DryRunPanel preview={dryRun} /> : null}

      {preview && dryRun?.ok ? (
        <form key={`commit-${uploadKey}`} action={commitAction} className="flex flex-col gap-3">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="csv" value={csv} />
          <input type="hidden" name="filename" value={filename} />
          {fields.map((field) => (
            <input key={field} type="hidden" name={`map_${field}`} value={mappedValue(preview.map, field)} />
          ))}
          <button className={buttonClass} type="submit" disabled={commitPending || appReadonly}>
            {appReadonly ? "App is frozen" : "Commit import"}
          </button>
        </form>
      ) : null}

      {committed ? (
        <p className="text-sm" role="status">
          Committed batch {committed.batchId}: {committed.posted} ledger row(s), {committed.entries}{" "}
          historical entry(ies).
        </p>
      ) : null}
      {failed ? (
        <p className="text-sm text-red-600" role="alert">
          {failed.error}
        </p>
      ) : null}
    </div>
  );
}

function mappedValue(map: ColumnMap | undefined, field: ImportField): string {
  const value = map?.[field];
  return value == null ? "" : String(value);
}

function DryRunPanel({ preview }: { preview: DryRunResult }) {
  return (
    <section className="flex flex-col gap-3 text-sm">
      <h2 className="text-lg font-medium">Dry-run</h2>
      {!preview.ok ? (
        <div className="text-red-600" role="alert">
          <p>{preview.errors.length} error(s). Commit is blocked.</p>
          <ul className="mt-2 list-disc pl-5">
            {preview.errors.slice(0, 20).map((err) => (
              <li key={`${err.line}-${err.message}`}>
                Line {err.line}: {err.message}
              </li>
            ))}
          </ul>
          <a
            className="mt-2 inline-block underline"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(preview.errorCsv)}`}
            download="import-errors.csv"
          >
            Download error CSV
          </a>
        </div>
      ) : (
        <p role="status">
          {preview.posts.length} ledger post(s), {preview.entries.length} historical entry(ies).
          {preview.warnings.length > 0 ? ` ${preview.warnings.length} warning(s).` : ""}
        </p>
      )}

      {preview.diffs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Sheet remaining</th>
                <th className="py-2 pr-4 font-medium">App remaining</th>
                <th className="py-2 font-medium">Adjust (h)</th>
              </tr>
            </thead>
            <tbody>
              {preview.diffs.map((row) => (
                <tr key={`${row.line}-${row.email}`} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">{row.email}</td>
                  <td className="py-2 pr-4">{row.leaveType}</td>
                  <td className="py-2 pr-4 font-mono">{formatHours(row.sheetRemainingMinutes)}</td>
                  <td className="py-2 pr-4 font-mono">{formatHours(row.appRemainingMinutes)}</td>
                  <td className="py-2 font-mono">{formatHours(row.deltaMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

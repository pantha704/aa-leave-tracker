"use client";

import { useActionState } from "react";
import { importHolidaysAction, type HolidayImportState } from "./actions";

export function HolidayImportForm() {
  const [state, action, pending] = useActionState(importHolidaysAction, undefined);

  return (
    <form action={action} className="flex max-w-xl flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Holiday CSV
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="replaceExisting" value="on" defaultChecked />
        Update names when the date and region already exist
      </label>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Columns: date, name, optional region. Dates are ISO <code>YYYY-MM-DD</code>. Unique per
        organization, date, and region. New dates import all-or-nothing.
      </p>
      {state ? <ImportResult state={state} /> : null}
      <button
        className="w-fit rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        type="submit"
        disabled={pending}
      >
        Import CSV
      </button>
    </form>
  );
}

function ImportResult({ state }: { state: NonNullable<HolidayImportState> }) {
  if (state.ok) {
    return (
      <p className="mt-0 text-sm text-zinc-700 dark:text-zinc-300" role="status">
        Imported {state.imported}, updated {state.updated}.
      </p>
    );
  }

  return (
    <div className="text-sm text-red-600" role="alert">
      <p>{state.error}</p>
      {state.errors?.length ? (
        <ul className="mt-2 list-disc pl-5">
          {state.errors.slice(0, 20).map((err) => (
            <li key={`${err.line}-${err.message}`}>
              Line {err.line}: {err.message}
            </li>
          ))}
        </ul>
      ) : null}
      {state.errorCsv ? (
        <a
          className="mt-2 inline-block underline"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(state.errorCsv)}`}
          download="holiday-import-errors.csv"
        >
          Download error CSV
        </a>
      ) : null}
    </div>
  );
}

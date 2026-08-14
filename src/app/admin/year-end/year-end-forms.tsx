"use client";

import { useActionState } from "react";
import {
  closeYearAction,
  openFirstYearAction,
  previewCloseAction,
  reopenYearAction,
  type YearEndFormState,
} from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

function FormAlert({ state }: { state: YearEndFormState }) {
  if (!state) return null;
  if (!state.ok) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.kind === "preview") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
        Preview {state.year}: {state.rows.length} employee×type row(s).
      </p>
    );
  }
  if (state.kind === "closed") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
        Closed {state.year}. Snapshot {state.snapshotPath}.
      </p>
    );
  }
  if (state.kind === "reopened") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
        Reopened {state.year}; reversed {state.reversed} ledger row(s).
      </p>
    );
  }
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
      Opened {state.year}; posted {state.posts} sick grant(s). No vacation lump.
    </p>
  );
}

function YearField({ defaultYear }: { defaultYear: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      Year
      <input className={fieldClass} name="year" type="number" required defaultValue={defaultYear} />
    </label>
  );
}

export function YearEndForms({ defaultYear }: { defaultYear: number }) {
  const [previewState, preview, previewPending] = useActionState(previewCloseAction, undefined);
  const [closeState, close, closePending] = useActionState(closeYearAction, undefined);
  const [reopenState, reopen, reopenPending] = useActionState(reopenYearAction, undefined);
  const [openState, openYear, openPending] = useActionState(openFirstYearAction, undefined);

  const previewRows = previewState?.ok && previewState.kind === "preview" ? previewState.rows : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">First-year open</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          After seed: assign policies, then open the <em>same</em> year (grants Sick). Refuses if
          another year is already open. Inserts Y+1 as <span className="font-mono">future</span> so
          December can request January. Does not write a 17-day Vacation/Unpaid lump.
        </p>
        <form action={openYear} className="flex flex-wrap items-end gap-3">
          <YearField defaultYear={defaultYear} />
          <button className={buttonClass} type="submit" disabled={openPending}>
            Open year
          </button>
        </form>
        <FormAlert state={openState} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Close year</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Preview then close with the same forfeit acknowledgement. Finish before the first January
          working day. Carryover only — unused above the cap is not deleted unless the policy allows
          forfeit and you acknowledge (legal call is HR&apos;s).
        </p>
        <form className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <YearField defaultYear={defaultYear} />
            <label className="flex items-center gap-2 text-sm">
              <input name="acknowledge_forfeit" type="checkbox" />
              Acknowledge forfeit
            </label>
            <button className={buttonClass} type="submit" formAction={preview} disabled={previewPending}>
              Preview close
            </button>
            <button className={buttonClass} type="submit" formAction={close} disabled={closePending}>
              Close year
            </button>
          </div>
        </form>
        <FormAlert state={previewState} />
        <FormAlert state={closeState} />
        {previewRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Unused</th>
                  <th className="py-2 pr-4 font-medium">Carry</th>
                  <th className="py-2 pr-4 font-medium">Forfeit</th>
                  <th className="py-2 font-medium">Sick grant Y+1</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr
                    key={`${row.employeeId}-${row.leaveTypeId}`}
                    className="border-b border-zinc-100 dark:border-zinc-900"
                  >
                    <td className="py-2 pr-4">{row.employeeName}</td>
                    <td className="py-2 pr-4 font-mono">{row.leaveTypeCode}</td>
                    <td className="py-2 pr-4 font-mono">{row.unusedMinutes}</td>
                    <td className="py-2 pr-4 font-mono">{row.carryMinutes}</td>
                    <td className="py-2 pr-4 font-mono">{row.forfeitMinutes}</td>
                    <td className="py-2 font-mono">{row.sickGrantMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Reopen</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Reverses close-created carryover and sick grants (sets reversed_at). Refuses if Y+1 already
          has other live activity.
        </p>
        <form action={reopen} className="flex flex-wrap items-end gap-3">
          <YearField defaultYear={defaultYear} />
          <button className={buttonClass} type="submit" disabled={reopenPending}>
            Reopen year
          </button>
        </form>
        <FormAlert state={reopenState} />
      </section>
    </div>
  );
}

"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { submitLeaveAction, type LeaveFormState } from "@/app/me/actions";
import { formatDays, formatHours, formatUnitPair } from "@/lib/hours";
import { previewLeave } from "@/lib/leave-preview";
import type { Portion } from "@/server/policy/types";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

export type LeaveFormType = {
  id: string;
  code: string;
  name: string;
  consumesBalance: boolean;
  unlimited: boolean;
  availableMinutes: number;
  legalUnit: string;
  minIncrementMinutes: number | null;
  negativeAllowed: boolean;
  negativeFloorMinutes: number | null;
};

export type LeaveFormProps = {
  types: LeaveFormType[];
  holidays: readonly string[];
  weekendDays: readonly number[];
  workdayMinutes: number;
  today: string;
};

export function LeaveForm({ types, holidays, weekendDays, workdayMinutes, today }: LeaveFormProps) {
  const [state, action, pending] = useActionState(submitLeaveAction, undefined);
  const [formKey, setFormKey] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? "");
  const [portion, setPortion] = useState<Portion>("full");
  const [customHours, setCustomHours] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state?.ok) {
      setFormKey((key) => key + 1);
      setStartDate("");
      setEndDate("");
      setPortion("full");
      setCustomHours("");
      setNote("");
    }
  }, [state]);

  const selected = types.find((type) => type.id === leaveTypeId) ?? types[0];

  const preview = useMemo(() => {
    if (!selected) {
      return {
        ok: false as const,
        code: "NO_POLICY",
        message: "No policy assignment for this employee and leave type.",
      };
    }
    return previewLeave({
      startDate,
      endDate,
      portion,
      customHours,
      consumesBalance: selected.consumesBalance,
      unlimited: selected.unlimited,
      availableMinutes: selected.availableMinutes,
      holidays,
      weekendDays,
      workdayMinutes,
      today,
      incrementMinutes: selected.minIncrementMinutes,
      negativeAllowed: selected.negativeAllowed,
      negativeFloorMinutes: selected.negativeFloorMinutes,
    });
  }, [customHours, endDate, holidays, portion, selected, startDate, today, weekendDays, workdayMinutes]);

  return (
    <form key={formKey} action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <label className="flex flex-col gap-0.5 text-xs">
          Start
          <input
            className={fieldClass}
            type="date"
            name="startDate"
            required
            tabIndex={1}
            value={startDate}
            onChange={(event) => {
              const next = event.target.value;
              setStartDate(next);
              if (!endDate || endDate < next) setEndDate(next);
            }}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          End
          <input
            className={fieldClass}
            type="date"
            name="endDate"
            required
            tabIndex={2}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          Type
          <select
            className={fieldClass}
            name="leaveTypeId"
            required
            tabIndex={3}
            value={leaveTypeId}
            onChange={(event) => setLeaveTypeId(event.target.value)}
            disabled={types.length === 0}
          >
            {types.length === 0 ? <option value="">No assigned types</option> : null}
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          Portion
          <select
            className={fieldClass}
            name="portion"
            tabIndex={4}
            value={portion}
            onChange={(event) => setPortion(event.target.value as Portion)}
          >
            <option value="full">full</option>
            <option value="am">am</option>
            <option value="pm">pm</option>
            <option value="custom">custom</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          Custom hours
          <input
            className={fieldClass}
            name="customHours"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            tabIndex={5}
            placeholder="e.g. 2.67"
            value={customHours}
            onChange={(event) => setCustomHours(event.target.value)}
            disabled={portion !== "custom"}
            required={portion === "custom"}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          Note
          <input
            className={fieldClass}
            name="note"
            type="text"
            tabIndex={6}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      <LeavePreview
        state={preview}
        unlimited={selected?.unlimited ?? false}
        workdayMinutes={workdayMinutes}
        legalUnit={selected?.legalUnit ?? "hours"}
      />
      <FormResult state={state} />

      <button
        className={`${buttonClass} w-fit`}
        type="submit"
        tabIndex={7}
        disabled={pending || types.length === 0 || !preview.ok}
      >
        {pending ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}

function pairLabel(minutes: number, workdayMinutes: number, legalUnit: string): string {
  const pair = formatUnitPair(minutes, workdayMinutes, legalUnit);
  return `${pair.primary} (${pair.secondary})`;
}

function LeavePreview({
  state,
  unlimited,
  workdayMinutes,
  legalUnit,
}: {
  state: ReturnType<typeof previewLeave>;
  unlimited: boolean;
  workdayMinutes: number;
  legalUnit: string;
}) {
  if (!state.ok) {
    if (state.code === "INVALID_DATES" && state.message === "Choose a start and end date.") {
      return (
        <p className="text-xs text-zinc-600 dark:text-zinc-400" aria-live="polite">
          Available preview appears after dates are set.
        </p>
      );
    }
    return (
      <p className="text-xs text-red-600" aria-live="polite" role="status">
        <span className="font-mono font-semibold">{state.code}</span>
        {" — "}
        {state.message}
      </p>
    );
  }

  const thisLabel = pairLabel(state.thisMinutes, workdayMinutes, legalUnit);
  const availableLabel = unlimited
    ? "unlimited"
    : pairLabel(state.availableMinutes, workdayMinutes, legalUnit);
  const afterLabel =
    unlimited || state.availableAfterMinutes == null
      ? null
      : pairLabel(state.availableAfterMinutes, workdayMinutes, legalUnit);

  return (
    <p className="text-xs tabular-nums text-zinc-700 dark:text-zinc-300" aria-live="polite">
      Intent <span className="font-medium">{state.intent}</span>
      {" · this "}
      {thisLabel}
      {" · available "}
      {availableLabel}
      {afterLabel ? ` → ${afterLabel} after` : null}
      {state.otherPeriodYear ? (
        <span className="block text-zinc-500">
          After-hours is this year only; submit still checks {formatHours(state.thisMinutes)}h /{" "}
          {formatDays(state.thisMinutes, workdayMinutes)}d against the period year of each day.
        </span>
      ) : null}
    </p>
  );
}

function FormResult({ state }: { state: LeaveFormState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300" role="status">
        {state.intent === "log" ? "Logged" : "Requested"} {state.hours}h
        {state.status === "pending" ? " (pending)" : ""}.
      </p>
    );
  }
  return (
    <p className="text-sm text-red-600" role="alert">
      <span className="font-mono font-semibold">{state.code}</span>
      {" — "}
      {state.message}
    </p>
  );
}

"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type { Balance } from "@/server/ledger/balance";
import {
  grantMinutesForTenure,
  isBlankTenureBandRow,
  type TenureBandInput,
} from "@/server/policy/grant";
import {
  previewSampleBalanceAction,
  savePolicyAction,
  type PolicyFormState,
} from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";
const textareaClass =
  "min-h-64 w-full rounded border border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs leading-5 dark:border-zinc-700";

export type PolicyFormEmployee = {
  id: string;
  name: string;
  email: string;
  startDate: string;
  workdayMinutes: number | null;
};

export type PolicyFormLeaveType = {
  id: string;
  code: string;
  name: string;
};

type BandDraft = {
  minYears: string;
  maxYears: string;
  grantMinutes: string;
};

const EMPTY_BAND: BandDraft = { minYears: "", maxYears: "", grantMinutes: "" };

const PERIODS = ["calendar_year", "anniversary"] as const;
const GRANT_MODES = ["lump_sum", "periodic", "hourly_worked", "none"] as const;
const PERIODIC_CADENCES = ["monthly", "biweekly", "weekly"] as const;
const APPROVAL_MODES = ["none", "manager", "admin"] as const;

export type PolicyFormValue = {
  leaveTypeId: string;
  name: string;
  period: string;
  grantMode: string;
  grantMinutes: number | null;
  periodicCadence: string | null;
  periodicMinutes: number | null;
  accrualStopMinutes: number | null;
  takeCeilingMinutes: number | null;
  carryoverMaxMinutes: number | null;
  allowForfeit: boolean;
  negativeAllowed: boolean;
  negativeFloorMinutes: number | null;
  waitingPeriodDays: number;
  approvalForRequest: string;
  approvalForLog: string;
  noticeDays: number | null;
  minIncrementMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  tenureBands: TenureBandInput[];
};

function FormAlert({ state }: { state: PolicyFormState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400" role="status">
        Saved.
      </p>
    );
  }
  return (
    <p className="text-sm text-red-600" role="alert">
      {state.error}
    </p>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      {children}
    </label>
  );
}

function optionalNumber(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function bandsFromPolicy(policy?: PolicyFormValue): BandDraft[] {
  if (!policy || policy.tenureBands.length === 0) return [];
  return policy.tenureBands.map((band) => ({
    minYears: String(band.minYears),
    maxYears: band.maxYears == null ? "" : String(band.maxYears),
    grantMinutes: String(band.grantMinutes),
  }));
}

function parsedBands(drafts: BandDraft[]): TenureBandInput[] {
  return drafts.flatMap((band) => {
    const min_years = optionalNumber(band.minYears);
    const max_years = optionalNumber(band.maxYears);
    const grant_minutes = optionalNumber(band.grantMinutes);
    if (isBlankTenureBandRow({ min_years, max_years, grant_minutes })) return [];
    if (min_years == null || grant_minutes == null) return [];
    return [{ minYears: min_years, maxYears: max_years, grantMinutes: grant_minutes }];
  });
}

function formatMinutes(minutes: number, workdayMinutes: number): string {
  const hours = (minutes / 60).toFixed(2);
  const days = workdayMinutes > 0 ? (minutes / workdayMinutes).toFixed(2) : "—";
  return `${minutes} min · ${hours}h · ${days}d`;
}

const BALANCE_BUCKETS = [
  ["Granted", "grantedMinutes"],
  ["Taken", "takenMinutes"],
  ["Scheduled", "scheduledMinutes"],
  ["Requested", "requestedMinutes"],
  ["Remaining", "remainingMinutes"],
  ["Available", "availableMinutes"],
] as const;

function BalanceStrip({
  balance,
  workdayMinutes,
}: {
  balance: Balance;
  workdayMinutes: number;
}) {
  return (
    <dl className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
      {BALANCE_BUCKETS.map(([label, field]) => (
        <div key={field} className="px-0 py-1">
          <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
          <dd className="font-mono text-xs tabular-nums">
            {formatMinutes(balance[field], workdayMinutes)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PolicyForm({
  id,
  policy,
  initialJson,
  leaveTypes,
  employees,
  today,
  workdayMinutes,
}: {
  id?: string;
  policy?: PolicyFormValue;
  initialJson: string;
  leaveTypes: PolicyFormLeaveType[];
  employees: PolicyFormEmployee[];
  today: string;
  workdayMinutes: number;
}) {
  const [state, action, pending] = useActionState(savePolicyAction, undefined);
  const [grantMode, setGrantMode] = useState(policy?.grantMode ?? "periodic");
  const [grantMinutes, setGrantMinutes] = useState(
    policy?.grantMinutes == null ? "" : String(policy.grantMinutes),
  );
  const [leaveTypeId, setLeaveTypeId] = useState(
    policy?.leaveTypeId ?? (leaveTypes.length === 1 ? leaveTypes[0].id : ""),
  );
  const [bands, setBands] = useState<BandDraft[]>(() => bandsFromPolicy(policy));
  const [sampleId, setSampleId] = useState(employees[0]?.id ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balancePending, startBalance] = useTransition();

  const sample = employees.find((person) => person.id === sampleId) ?? null;
  const preview = useMemo(() => {
    if (!sample) return null;
    return grantMinutesForTenure({
      grantMinutes: optionalNumber(grantMinutes),
      tenureBands: parsedBands(bands),
      startDate: sample.startDate,
      asOf: today,
    });
  }, [sample, grantMinutes, bands, today]);

  useEffect(() => {
    if (!previewOpen || !sample || !leaveTypeId) return;
    let cancelled = false;
    startBalance(async () => {
      const result = await previewSampleBalanceAction(sample.id, leaveTypeId);
      if (cancelled) return;
      if (result.ok) {
        setBalance(result.balance);
        setBalanceError(null);
      } else {
        setBalance(null);
        setBalanceError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewOpen, sample, leaveTypeId]);

  const sampleWorkday = sample?.workdayMinutes ?? workdayMinutes;

  return (
    <form action={action} className="flex flex-col gap-5">
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Leave type">
          {id ? (
            <>
              <input type="hidden" name="leave_type_id" value={leaveTypeId} />
              <select className={fieldClass} value={leaveTypeId} disabled>
                {leaveTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.code} — {type.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <select
              className={fieldClass}
              name="leave_type_id"
              required
              value={leaveTypeId}
              onChange={(event) => setLeaveTypeId(event.target.value)}
            >
              <option value="" disabled>
                Select leave type
              </option>
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} — {type.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Name">
          <input className={fieldClass} name="name" required defaultValue={policy?.name ?? ""} />
        </Field>
        <Field label="Period">
          <select className={fieldClass} name="period" defaultValue={policy?.period ?? "calendar_year"}>
            {PERIODS.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Effective from">
          <input
            className={fieldClass}
            name="effective_from"
            type="date"
            required
            defaultValue={policy?.effectiveFrom ?? "2026-01-01"}
          />
        </Field>
        <Field label="Effective to (optional)">
          <input
            className={fieldClass}
            name="effective_to"
            type="date"
            defaultValue={policy?.effectiveTo ?? ""}
          />
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Grant</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Grant mode">
            <select
              className={fieldClass}
              name="grant_mode"
              value={grantMode}
              onChange={(event) => setGrantMode(event.target.value)}
            >
              {GRANT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grant minutes (annual)">
            <input
              className={fieldClass}
              name="grant_minutes"
              type="number"
              min={0}
              step={1}
              value={grantMinutes}
              onChange={(event) => setGrantMinutes(event.target.value)}
            />
          </Field>
          {grantMode === "periodic" ? (
            <>
              <Field label="Periodic cadence">
                <select
                  className={fieldClass}
                  name="periodic_cadence"
                  defaultValue={policy?.periodicCadence ?? "monthly"}
                >
                  {PERIODIC_CADENCES.map((cadence) => (
                    <option key={cadence} value={cadence}>
                      {cadence}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Periodic minutes">
                <input
                  className={fieldClass}
                  name="periodic_minutes"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={policy?.periodicMinutes ?? ""}
                />
              </Field>
            </>
          ) : (
            <>
              <input type="hidden" name="periodic_cadence" value="" />
              <input type="hidden" name="periodic_minutes" value="" />
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Caps</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Accrual-stop minutes">
            <input
              className={fieldClass}
              name="accrual_stop_minutes"
              type="number"
              min={0}
              step={1}
              defaultValue={policy?.accrualStopMinutes ?? ""}
            />
          </Field>
          <Field label="Take-ceiling minutes">
            <input
              className={fieldClass}
              name="take_ceiling_minutes"
              type="number"
              min={0}
              step={1}
              defaultValue={policy?.takeCeilingMinutes ?? ""}
            />
          </Field>
          <Field label="Carryover max minutes">
            <input
              className={fieldClass}
              name="carryover_max_minutes"
              type="number"
              min={0}
              step={1}
              defaultValue={policy?.carryoverMaxMinutes ?? ""}
            />
          </Field>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Flags and approval</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Allow forfeit">
            <select
              className={fieldClass}
              name="allow_forfeit"
              defaultValue={policy?.allowForfeit ? "true" : "false"}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </Field>
          <Field label="Negative allowed">
            <select
              className={fieldClass}
              name="negative_allowed"
              defaultValue={policy?.negativeAllowed ? "true" : "false"}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </Field>
          <Field label="Negative floor minutes">
            <input
              className={fieldClass}
              name="negative_floor_minutes"
              type="number"
              step={1}
              defaultValue={policy?.negativeFloorMinutes ?? ""}
            />
          </Field>
          <Field label="Waiting period (days)">
            <input
              className={fieldClass}
              name="waiting_period_days"
              type="number"
              min={0}
              step={1}
              defaultValue={policy?.waitingPeriodDays ?? 0}
            />
          </Field>
          <Field label="Approval for request">
            <select
              className={fieldClass}
              name="approval_for_request"
              defaultValue={policy?.approvalForRequest ?? "admin"}
            >
              {APPROVAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Approval for log">
            <select
              className={fieldClass}
              name="approval_for_log"
              defaultValue={policy?.approvalForLog ?? "none"}
            >
              {APPROVAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notice days">
            <input
              className={fieldClass}
              name="notice_days"
              type="number"
              min={0}
              step={1}
              defaultValue={policy?.noticeDays ?? ""}
            />
          </Field>
          <Field label="Min increment minutes">
            <input
              className={fieldClass}
              name="min_increment_minutes"
              type="number"
              min={1}
              step={1}
              defaultValue={policy?.minIncrementMinutes ?? 60}
            />
          </Field>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Tenure bands</h3>
          <button
            className="text-xs underline"
            type="button"
            onClick={() => setBands((rows) => [...rows, { ...EMPTY_BAND }])}
          >
            Add band
          </button>
        </div>
        <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
          Inclusive years of service. Empty max is unbounded. If no band matches, grant minutes
          above apply.
        </p>
        {bands.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No tenure bands.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {bands.map((band, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-4">
                <Field label="Min years">
                  <input
                    className={fieldClass}
                    name="tenure_min_years"
                    type="number"
                    min={0}
                    step={1}
                    value={band.minYears}
                    onChange={(event) =>
                      setBands((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, minYears: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Max years">
                  <input
                    className={fieldClass}
                    name="tenure_max_years"
                    type="number"
                    min={0}
                    step={1}
                    value={band.maxYears}
                    onChange={(event) =>
                      setBands((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, maxYears: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Grant minutes">
                  <input
                    className={fieldClass}
                    name="tenure_grant_minutes"
                    type="number"
                    min={0}
                    step={1}
                    value={band.grantMinutes}
                    onChange={(event) =>
                      setBands((rows) =>
                        rows.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, grantMinutes: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
                <div className="flex items-end">
                  <button
                    className="text-xs text-red-600 underline"
                    type="button"
                    onClick={() => setBands((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <details
        className="rounded border border-zinc-200 px-3 py-3 dark:border-zinc-800"
        onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-medium">Preview</summary>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Tenure uses the sample employee start date vs org today ({today}). Grant is computed
          from the draft form, not a saved policy.
        </p>
        {employees.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No employees to preview.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Sample employee">
              <select
                className={fieldClass}
                value={sampleId}
                onChange={(event) => setSampleId(event.target.value)}
              >
                {employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} ({person.email})
                  </option>
                ))}
              </select>
            </Field>
            {sample && preview ? (
              <div className="text-sm">
                <p>
                  Start <span className="font-mono">{sample.startDate}</span>
                  {" · "}
                  {preview.tenureYears == null
                    ? "tenure unknown"
                    : `${preview.tenureYears} year${preview.tenureYears === 1 ? "" : "s"}`}
                </p>
                <p className="mt-1">
                  Computed grant:{" "}
                  {preview.grantMinutes == null ? (
                    "none"
                  ) : (
                    <span className="font-mono">{formatMinutes(preview.grantMinutes, sampleWorkday)}</span>
                  )}
                  <span className="ml-2 text-xs text-zinc-500">
                    {preview.grantSource === "tenure_band"
                      ? `band ${preview.band?.minYears}–${preview.band?.maxYears ?? "∞"}`
                      : "policy grant_minutes"}
                  </span>
                </p>
              </div>
            ) : null}
            {!sample || !leaveTypeId ? (
              <p className="text-xs text-zinc-500">
                Ledger strip needs a leave type. Grant minutes above still update from the form.
              </p>
            ) : balancePending ? (
              <p className="text-xs text-zinc-500">Loading ledger balance…</p>
            ) : balance ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                  Ledger balance as of {balance.asOf}
                </p>
                <BalanceStrip balance={balance} workdayMinutes={sampleWorkday} />
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{balanceError ?? "No ledger balance loaded."}</p>
            )}
          </div>
        )}
      </details>

      <FormAlert state={state} />
      <button className={`${buttonClass} w-fit`} type="submit" name="mode" value="form" disabled={pending}>
        {id ? "Save policy" : "Create policy"}
      </button>

      <details className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">Advanced JSON</summary>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Optional. Save JSON writes this payload instead of the form fields.
        </p>
        <textarea
          className={`${textareaClass} mt-2`}
          name="json"
          defaultValue={initialJson}
          spellCheck={false}
        />
        <button
          className={`${buttonClass} mt-2`}
          type="submit"
          name="mode"
          value="json"
          disabled={pending}
        >
          Save JSON
        </button>
      </details>
    </form>
  );
}

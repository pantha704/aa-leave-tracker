"use client";

import { useActionState } from "react";
import type { FileLeaveEntry, PolicyOption } from "@/server/admin/employees";
import {
  adjustHoursAction,
  assignPolicyAction,
  decideEntryAction,
  terminateEmployeeAction,
  type AdminFormState,
} from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

function FormAlert({ state }: { state: AdminFormState }) {
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

export function AdjustHoursForm({
  employeeId,
  leaveTypes,
}: {
  employeeId: string;
  leaveTypes: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(adjustHoursAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1 text-xs">
        Leave type
        <select className={fieldClass} name="leaveTypeId" required>
          {leaveTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Hours (signed)
        <input className={fieldClass} name="hours" required placeholder="8.00" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Effective on
        <input className={fieldClass} name="effectiveOn" type="date" required />
      </label>
      <label className="flex flex-col gap-1 text-xs sm:col-span-2 lg:col-span-4">
        Reason (required)
        <input className={fieldClass} name="reason" required />
      </label>
      <div className="flex items-end gap-3">
        <button className={buttonClass} type="submit" disabled={pending}>
          Adjust hours
        </button>
        <FormAlert state={state} />
      </div>
    </form>
  );
}

export function AssignPolicyForm({
  employeeId,
  policies,
}: {
  employeeId: string;
  policies: PolicyOption[];
}) {
  const [state, action, pending] = useActionState(assignPolicyAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1 text-xs">
        Policy
        <select className={fieldClass} name="policyId" required>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name} ({policy.leaveTypeCode})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Valid from
        <input className={fieldClass} name="validFrom" type="date" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Valid to
        <input className={fieldClass} name="validTo" type="date" />
      </label>
      <div className="flex items-end gap-3">
        <button className={buttonClass} type="submit" disabled={pending || policies.length === 0}>
          Assign policy
        </button>
        <FormAlert state={state} />
      </div>
    </form>
  );
}

export function DecideEntryForm({
  entry,
  employeeId,
}: {
  entry: Pick<FileLeaveEntry, "id" | "status">;
  employeeId: string;
}) {
  const [state, action, pending] = useActionState(decideEntryAction, undefined);
  const canDecidePending = entry.status === "pending";
  const canCancelApproved = entry.status === "approved";
  if (!canDecidePending && !canCancelApproved) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="entryId" value={entry.id} />
      <input type="hidden" name="employeeId" value={employeeId} />
      {canDecidePending ? (
        <>
          <input
            className={`${fieldClass} w-40`}
            name="adminNote"
            placeholder="Admin note"
          />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="override" />
            Override
          </label>
          <button className={buttonClass} name="action" value="approve" type="submit" disabled={pending}>
            Approve
          </button>
          <button
            className="text-sm text-red-600 underline disabled:opacity-60"
            name="action"
            value="reject"
            type="submit"
            disabled={pending}
          >
            Reject
          </button>
          <button
            className="text-sm text-zinc-600 underline disabled:opacity-60"
            name="action"
            value="cancel"
            type="submit"
            disabled={pending}
          >
            Cancel
          </button>
        </>
      ) : null}
      {canCancelApproved ? (
        <button
          className="text-sm text-red-600 underline disabled:opacity-60"
          name="action"
          value="cancel"
          type="submit"
          disabled={pending}
        >
          Cancel
        </button>
      ) : null}
      <FormAlert state={state} />
    </form>
  );
}

export function TerminateEmployeeForm({
  employeeId,
}: {
  employeeId: string;
}) {
  const [state, action, pending] = useActionState(terminateEmployeeAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1 text-xs">
        End date
        <input className={fieldClass} name="endDate" type="date" required />
      </label>
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        Reason (required)
        <input className={fieldClass} name="reason" required />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <button
          className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          type="submit"
          disabled={pending}
        >
          Terminate
        </button>
        <FormAlert state={state} />
        {state?.ok && state.downloadPath ? (
          <a className="text-sm underline" href={state.downloadPath}>
            Download termination CSV
          </a>
        ) : null}
      </div>
    </form>
  );
}

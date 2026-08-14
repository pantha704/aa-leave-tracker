"use client";

import { useActionState, useEffect, useState } from "react";
import type { LeaveTypeRecord } from "@/server/leave-types";
import {
  createLeaveTypeAction,
  deleteLeaveTypeAction,
  updateLeaveTypeAction,
  type LeaveTypeFormState,
} from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

function FormAlert({ state }: { state: LeaveTypeFormState }) {
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

function LeaveTypeFields({
  value,
  lockIdentity,
}: {
  value?: LeaveTypeRecord;
  lockIdentity?: boolean;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs">
        Code
        <input className={fieldClass} name="code" defaultValue={value?.code ?? ""} required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Name
        <input className={fieldClass} name="name" defaultValue={value?.name ?? ""} required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Consumes balance
        <select
          className={fieldClass}
          name="consumesBalance"
          defaultValue={value?.consumesBalance === false ? "false" : "true"}
          disabled={lockIdentity}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        {lockIdentity ? (
          <input
            type="hidden"
            name="consumesBalance"
            value={value?.consumesBalance === false ? "false" : "true"}
          />
        ) : null}
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Legal unit
        <select
          className={fieldClass}
          name="legalUnit"
          defaultValue={value?.legalUnit ?? "hours"}
          disabled={lockIdentity}
        >
          <option value="hours">hours</option>
          <option value="days">days</option>
        </select>
        {lockIdentity ? (
          <input type="hidden" name="legalUnit" value={value?.legalUnit ?? "hours"} />
        ) : null}
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Min increment (minutes)
        <input
          className={fieldClass}
          name="minIncrementMinutes"
          type="number"
          min={1}
          step={1}
          defaultValue={value?.minIncrementMinutes ?? ""}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Color
        <input className={fieldClass} name="color" defaultValue={value?.color ?? ""} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Unlimited
        <select
          className={fieldClass}
          name="unlimited"
          defaultValue={value?.unlimited === true ? "true" : "false"}
        >
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Visible on team calendar
        <select
          className={fieldClass}
          name="visibleOnTeamCalendar"
          defaultValue={value?.visibleOnTeamCalendar === false ? "false" : "true"}
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
    </>
  );
}

export function CreateLeaveTypeForm() {
  const [state, action, pending] = useActionState(createLeaveTypeAction, undefined);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (state?.ok) setFormKey((key) => key + 1);
  }, [state]);

  return (
    <form key={formKey} action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LeaveTypeFields />
      </div>
      <FormAlert state={state} />
      <button className={`${buttonClass} w-fit`} type="submit" disabled={pending}>
        Create leave type
      </button>
    </form>
  );
}

export function EditLeaveTypeForm({ leaveType }: { leaveType: LeaveTypeRecord }) {
  const [state, action, pending] = useActionState(updateLeaveTypeAction, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteLeaveTypeAction,
    undefined,
  );

  return (
    <div className="flex flex-col gap-2 border-b border-zinc-100 py-4 dark:border-zinc-900">
      <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="id" value={leaveType.id} />
        <LeaveTypeFields value={leaveType} lockIdentity={leaveType.inUse} />
        <div className="flex items-end">
          <button className={buttonClass} type="submit" disabled={pending}>
            Save
          </button>
        </div>
      </form>
      <form action={deleteAction}>
        <input type="hidden" name="id" value={leaveType.id} />
        <button
          className="text-sm text-red-600 underline disabled:opacity-60"
          type="submit"
          disabled={deletePending}
        >
          Delete
        </button>
      </form>
      <FormAlert state={state} />
      <FormAlert state={deleteState} />
    </div>
  );
}

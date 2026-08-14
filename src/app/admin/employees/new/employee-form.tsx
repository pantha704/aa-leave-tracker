"use client";

import { useActionState } from "react";
import { createEmployeeAction, reissueInviteAction } from "./actions";

export function EmployeeForm() {
  const [state, action, pending] = useActionState(createEmployeeAction, undefined);
  const [reissueState, reissue, reissuing] = useActionState(reissueInviteAction, undefined);
  const issued = reissueState && "invitePath" in reissueState ? reissueState : state;

  if (issued && "invitePath" in issued) {
    const inviteUrl = new URL(issued.invitePath, window.location.origin).href;
    return (
      <div className="mt-8 flex w-full max-w-sm flex-col gap-3 text-sm">
        <p>Employee created. Copy this invite link now — it is shown once.</p>
        <p className="break-all rounded border border-zinc-300 px-3 py-2 font-mono text-xs dark:border-zinc-700">
          {inviteUrl}
        </p>
        <form action={reissue}>
          <input type="hidden" name="employeeId" value={issued.employeeId} />
          <button
            className="underline disabled:opacity-60"
            type="submit"
            disabled={reissuing}
          >
            Re-issue invite
          </button>
        </form>
        {reissueState && "error" in reissueState ? (
          <p className="text-sm text-red-600" role="alert">
            {reissueState.error}
          </p>
        ) : null}
        <a className="underline" href="/admin/employees/new">
          Create another
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="mt-8 flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          type="text"
          name="name"
          autoComplete="name"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          type="email"
          name="email"
          autoComplete="email"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Start date
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          type="date"
          name="startDate"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Role
        <select
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          name="role"
          defaultValue="employee"
        >
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {state && "error" in state ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        type="submit"
        disabled={pending}
      >
        Create and invite
      </button>
    </form>
  );
}

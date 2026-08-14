"use client";

import { useActionState } from "react";
import { assignPolicyAction, type PolicyFormState } from "./actions";

const fieldClass =
  "rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700";
const buttonClass =
  "rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900";

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

export function AssignPolicyForm({
  employees,
  policies,
}: {
  employees: { id: string; name: string; email: string }[];
  policies: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(assignPolicyAction, undefined);

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs">
        Employee
        <select className={fieldClass} name="employee_id" required defaultValue="">
          <option value="" disabled>
            Select employee
          </option>
          {employees.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} ({person.email})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Policy
        <select className={fieldClass} name="policy_id" required defaultValue="">
          <option value="" disabled>
            Select policy
          </option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Valid from
        <input className={fieldClass} name="valid_from" type="date" required />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Valid to (optional)
        <input className={fieldClass} name="valid_to" type="date" />
      </label>
      <div className="flex items-end">
        <button className={buttonClass} type="submit" disabled={pending}>
          Assign
        </button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <FormAlert state={state} />
      </div>
    </form>
  );
}

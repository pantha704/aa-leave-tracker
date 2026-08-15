"use client";

import { useActionState } from "react";
import { changePasswordAction } from "../actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);

  return (
    <form action={action} className="mt-8 flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Current password
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        New password
        <input
          className="rounded border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        type="submit"
        disabled={pending}
      >
        Update password
      </button>
    </form>
  );
}

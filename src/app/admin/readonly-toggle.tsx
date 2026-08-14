"use client";

import { useActionState } from "react";
import { setAppReadonlyAction, type AdminSettingsState } from "./actions";

export function ReadonlyToggle({ appReadonly }: { appReadonly: boolean }) {
  const [state, action, pending] = useActionState<AdminSettingsState, FormData>(
    setAppReadonlyAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="appReadonly" value={appReadonly ? "false" : "true"} />
      <button
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        type="submit"
        disabled={pending}
      >
        {pending ? "Saving…" : appReadonly ? "Unfreeze app" : "Freeze app (readonly)"}
      </button>
      {state && !state.ok ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

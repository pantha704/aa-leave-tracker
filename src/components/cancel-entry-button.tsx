"use client";

import { useActionState } from "react";
import { cancelLeaveAction } from "@/app/me/actions";

export function CancelEntryButton({
  entryId,
  appReadonly = false,
}: {
  entryId: string;
  appReadonly?: boolean;
}) {
  const [state, action, pending] = useActionState(cancelLeaveAction, undefined);

  return (
    <form action={action} className="flex flex-col items-start gap-0.5">
      <input type="hidden" name="id" value={entryId} />
      <button
        className="text-xs text-red-600 underline disabled:opacity-60"
        type="submit"
        disabled={pending || appReadonly}
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {state && !state.ok ? (
        <span className="font-mono text-[11px] text-red-600" role="alert">
          {state.code}
        </span>
      ) : null}
    </form>
  );
}

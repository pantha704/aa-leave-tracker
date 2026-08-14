"use client";

import { useActionState } from "react";
import { reverseImportAction, type ReverseFormState } from "./actions";

export function ReverseBatchForm({
  batchId,
  appReadonly = false,
}: {
  batchId: string;
  appReadonly?: boolean;
}) {
  const [state, action, pending] = useActionState(reverseImportAction, undefined as ReverseFormState);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm("Reverse this import batch? Ledger rows are reversed, not deleted.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="batchId" value={batchId} />
      <button
        className="text-red-600 underline disabled:opacity-60"
        type="submit"
        disabled={pending || appReadonly}
      >
        Reverse
      </button>
      {state && !state.ok ? (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

import { requireAdmin } from "@/server/auth";
import { listLeaveTypes } from "@/server/leave-types";
import { CreateLeaveTypeForm, EditLeaveTypeForm } from "./leave-type-forms";

export default async function AdminLeaveTypesPage() {
  const { employee } = await requireAdmin();
  const types = await listLeaveTypes(employee.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin">
            Admin
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Leave types</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Types with leave entries or other related rows cannot be deleted.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">New type</h2>
        <CreateLeaveTypeForm />
      </section>

      <section>
        <h2 className="text-lg font-medium">Existing types</h2>
        {types.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No leave types yet.</p>
        ) : (
          <div className="mt-2">
            {types.map((leaveType) => (
              <EditLeaveTypeForm key={leaveType.id} leaveType={leaveType} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

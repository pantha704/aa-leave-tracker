import { requireAdmin } from "@/server/auth";
import { getOrgSettings } from "@/server/settings";
import { ReadonlyToggle } from "./readonly-toggle";

export default async function AdminPage() {
  const { employee } = await requireAdmin();
  const settings = await getOrgSettings(employee.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Roster, holidays, leave types, and CSV import for this organization.
        </p>
      </header>
      <nav className="flex flex-col gap-2 text-sm">
        <a className="underline" href="/admin/employees">
          Employees
        </a>
        <a className="underline" href="/admin/holidays">
          Holidays
        </a>
        <a className="underline" href="/admin/leave-types">
          Leave types
        </a>
        <a className="underline" href="/admin/import">
          CSV import
        </a>
      </nav>
      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Operations</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {settings.appReadonly
            ? "App is frozen (readonly). Leave writes are blocked."
            : "Dual-run: sheet is still source of truth."}
        </p>
        <ReadonlyToggle appReadonly={settings.appReadonly} />
      </section>
    </div>
  );
}

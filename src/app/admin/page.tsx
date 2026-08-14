import { requireAdmin } from "@/server/auth";

export default async function AdminPage() {
  await requireAdmin();

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
    </div>
  );
}

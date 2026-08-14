import { requireAdmin } from "@/server/auth";
import { loadOrgHolidays } from "@/server/holidays/import";
import { HolidayImportForm } from "./holiday-import-form";

export default async function AdminHolidaysPage() {
  const { employee } = await requireAdmin();
  const rows = await loadOrgHolidays(employee.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin">
            Admin
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Holidays</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Empty until HR imports a calendar. No US or India list is seeded.
        </p>
      </header>

      <HolidayImportForm />

      <section>
        <h2 className="text-lg font-medium">Imported dates</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 font-medium">Region</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={3}>
                    No holidays yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-mono">{row.onDate}</td>
                    <td className="py-2 pr-4">{row.name}</td>
                    <td className="py-2">{row.region ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

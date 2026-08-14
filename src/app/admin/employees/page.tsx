import { listPendingEntries, listRoster, minutesToHours } from "@/server/admin/employees";
import { requireAdmin } from "@/server/auth";
import { DecideEntryForm } from "./employee-file-forms";

export default async function AdminEmployeesPage({
  searchParams,
}: PageProps<"/admin/employees">) {
  const { employee } = await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const [rows, pending] = await Promise.all([
    listRoster({ orgId: employee.orgId, q }),
    listPendingEntries(employee.orgId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Employees</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Search the roster. Click a name for the employee file.
        </p>
      </header>

      <form className="flex gap-2" action="/admin/employees" method="get">
        <input
          className="w-full max-w-sm rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
          name="q"
          defaultValue={q}
          placeholder="Search name or email"
        />
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          type="submit"
        >
          Search
        </button>
      </form>

      <section>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Vacation remaining (h)</th>
                <th className="py-2 font-medium">Last entry</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={4}>
                    No employees match.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <a className="underline" href={`/admin/employees/${row.id}`}>
                        {row.name}
                      </a>
                      <div className="text-xs text-zinc-500">{row.email}</div>
                    </td>
                    <td className="py-2 pr-4">{row.employmentType}</td>
                    <td className="py-2 pr-4 font-mono">
                      {row.remainingVacationHours ?? "—"}
                    </td>
                    <td className="py-2 font-mono">{row.lastEntryDate ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="pending">
        <h2 className="text-lg font-medium">Pending requests</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Dates</th>
                <th className="py-2 pr-4 font-medium">Hours</th>
                <th className="py-2 font-medium">Decide</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={5}>
                    No pending requests.
                  </td>
                </tr>
              ) : (
                pending.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <a className="underline" href={`/admin/employees/${entry.employeeId}`}>
                        {entry.employeeName}
                      </a>
                    </td>
                    <td className="py-2 pr-4">{entry.leaveTypeCode}</td>
                    <td className="py-2 pr-4 font-mono">
                      {entry.startDate}
                      {entry.endDate !== entry.startDate ? ` – ${entry.endDate}` : ""}
                    </td>
                    <td className="py-2 pr-4 font-mono">{minutesToHours(entry.totalMinutes)}</td>
                    <td className="py-2">
                      <DecideEntryForm
                        employeeId={entry.employeeId}
                        entry={{ id: entry.id, status: "pending" }}
                      />
                    </td>
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

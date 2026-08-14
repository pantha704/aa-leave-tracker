import { requireAdmin } from "@/server/auth";
import { listPolicyPeriods } from "@/server/year-end";
import { YearEndForms } from "./year-end-forms";

export default async function AdminYearEndPage() {
  const { employee } = await requireAdmin();
  const periods = await listPolicyPeriods(employee.orgId);
  const defaultYear = periods.find((period) => period.status === "open")?.year ?? new Date().getUTCFullYear();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin">
            Admin
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Year-end</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Close year Y before the first January working day. Close writes carryover only (capped).
          It does not write a 17-day Vacation/Unpaid lump. Sick 3-day grant_lump posts when Y+1
          opens. Monthly accrual is a no-op until that period is open.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-medium">Periods</h2>
        {periods.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No period rows yet.</p>
        ) : (
          <table className="mt-3 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Year</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Closed at</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.year} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4 font-mono">{period.year}</td>
                  <td className="py-2 pr-4">{period.status}</td>
                  <td className="py-2 font-mono">
                    {period.closedAt ? period.closedAt.toISOString() : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <YearEndForms defaultYear={defaultYear} />
    </div>
  );
}

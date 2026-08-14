import { notFound } from "next/navigation";
import { loadEmployeeFile, minutesToHours } from "@/server/admin/employees";
import { requireAdmin } from "@/server/auth";
import {
  AdjustHoursForm,
  AssignPolicyForm,
  DecideEntryForm,
} from "../employee-file-forms";

function daysFromMinutes(minutes: number, workdayMinutes: number): string {
  if (workdayMinutes <= 0) return "—";
  return (minutes / workdayMinutes).toFixed(2);
}

export default async function AdminEmployeeFilePage({
  params,
}: PageProps<"/admin/employees/[id]">) {
  const { employee: actor } = await requireAdmin();
  const { id } = await params;
  const file = await loadEmployeeFile({ orgId: actor.orgId, employeeId: id });
  if (!file) notFound();

  const { employee, balances, ledger, entries, assignments, policies } = file;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin/employees">
            Employees
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{employee.name}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {employee.email} · {employee.role} · {employee.employmentType} · start{" "}
          {employee.startDate}
          {employee.endDate ? ` · end ${employee.endDate}` : ""} ·{" "}
          {employee.active ? "active" : "inactive"}
        </p>
      </header>

      <section>
        <h2 className="text-lg font-medium">Balance</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Granted</th>
                <th className="py-2 pr-4 font-medium">Taken</th>
                <th className="py-2 pr-4 font-medium">Scheduled</th>
                <th className="py-2 pr-4 font-medium">Requested</th>
                <th className="py-2 pr-4 font-medium">Remaining</th>
                <th className="py-2 font-medium">Available</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.leaveTypeId} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">{row.name}</td>
                  {(
                    [
                      row.balance.grantedMinutes,
                      row.balance.takenMinutes,
                      row.balance.scheduledMinutes,
                      row.balance.requestedMinutes,
                      row.balance.remainingMinutes,
                      row.balance.availableMinutes,
                    ] as const
                  ).map((minutes, index) => (
                    <td key={index} className="py-2 pr-4 font-mono">
                      {minutesToHours(minutes)}
                      <span className="ml-1 text-xs text-zinc-500">
                        ({daysFromMinutes(minutes, row.workdayMinutes)}d)
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Hours (days in muted text). As of {balances[0]?.balance.asOf ?? "—"}.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium">Adjust hours</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Posts a ledger adjustment. Reason is required.
        </p>
        <div className="mt-3">
          <AdjustHoursForm
            employeeId={employee.id}
            leaveTypes={balances.map((row) => ({
              id: row.leaveTypeId,
              code: row.code,
              name: row.name,
            }))}
          />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Assign policy</h2>
        <div className="mt-3">
          <AssignPolicyForm employeeId={employee.id} policies={policies} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Policy</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Valid from</th>
                <th className="py-2 font-medium">Valid to</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={4}>
                    No assignments.
                  </td>
                </tr>
              ) : (
                assignments.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">{row.policyName}</td>
                    <td className="py-2 pr-4">{row.leaveTypeCode}</td>
                    <td className="py-2 pr-4 font-mono">{row.validFrom}</td>
                    <td className="py-2 font-mono">{row.validTo ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Ledger</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">Hours</th>
                <th className="py-2 pr-4 font-medium">Running</th>
                <th className="py-2 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={6}>
                    No ledger rows.
                  </td>
                </tr>
              ) : (
                ledger.map((row) => {
                  const signed = row.minutes < 0;
                  const kindColor =
                    row.kind === "adjustment"
                      ? signed
                        ? "text-red-600"
                        : "text-blue-600"
                      : "";
                  return (
                    <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-mono">{row.effectiveOn}</td>
                      <td className="py-2 pr-4">{row.leaveTypeCode}</td>
                      <td className={`py-2 pr-4 ${kindColor}`}>{row.kind}</td>
                      <td className={`py-2 pr-4 font-mono ${kindColor}`}>{row.hours}</td>
                      <td className="py-2 pr-4 font-mono">
                        {row.runningRemainingMinutes == null
                          ? "—"
                          : minutesToHours(row.runningRemainingMinutes)}
                      </td>
                      <td className="py-2">
                        {row.reason ?? ""}
                        {row.reversedAt ? " (reversed)" : ""}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Entries</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Dates</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Hours</th>
                <th className="py-2 font-medium">Decide</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={5}>
                    No entries.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-mono">
                      {entry.startDate}
                      {entry.endDate !== entry.startDate ? ` – ${entry.endDate}` : ""}
                    </td>
                    <td className="py-2 pr-4">{entry.leaveTypeCode}</td>
                    <td className="py-2 pr-4">{entry.status}</td>
                    <td className="py-2 pr-4 font-mono">{minutesToHours(entry.totalMinutes)}</td>
                    <td className="py-2">
                      <DecideEntryForm employeeId={employee.id} entry={entry} />
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

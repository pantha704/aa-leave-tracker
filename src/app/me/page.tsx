import { CancelEntryButton } from "@/components/cancel-entry-button";
import { LeaveForm } from "@/components/leave-form";
import { formatUnitPair } from "@/lib/hours";
import { requireEmployee } from "@/server/auth";
import { authzActorFromEmployee } from "@/server/authz";
import { loadMyLeavePage } from "@/server/me";
import { getOrgSettings } from "@/server/settings";

const BUCKETS = [
  ["Granted", "grantedMinutes"],
  ["Taken", "takenMinutes"],
  ["Scheduled", "scheduledMinutes"],
  ["Requested", "requestedMinutes"],
  ["Remaining", "remainingMinutes"],
  ["Available", "availableMinutes"],
] as const;

function UnitAmount({
  minutes,
  workdayMinutes,
  legalUnit,
}: {
  minutes: number;
  workdayMinutes: number;
  legalUnit: string;
}) {
  const pair = formatUnitPair(minutes, workdayMinutes, legalUnit);
  return (
    <span className="font-mono text-sm tabular-nums">
      {pair.primary}
      <span className="ml-1 text-[11px] font-normal text-zinc-500">{pair.secondary}</span>
    </span>
  );
}

export default async function MePage() {
  const { employee } = await requireEmployee();
  const actor = authzActorFromEmployee(employee);
  const [page, settings] = await Promise.all([
    loadMyLeavePage(actor),
    getOrgSettings(employee.orgId),
  ]);
  const asOf = page.balances[0]?.balance.asOf ?? page.today;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My leave</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {page.employeeName}
            {" · as of "}
            <span className="font-mono tabular-nums">{asOf}</span>
          </p>
        </div>
        {employee.role === "admin" ? (
          <a className="text-sm underline" href="/admin">
            Admin
          </a>
        ) : null}
      </header>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Balance</h2>
        {page.balances.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No leave types assigned.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {page.balances.map((row) => (
              <div key={row.id} className="rounded border border-zinc-200 dark:border-zinc-800">
                <p className="border-b border-zinc-100 px-3 py-1.5 text-sm font-medium dark:border-zinc-900">
                  {row.name}
                  <span className="ml-2 font-mono text-xs font-normal text-zinc-500">{row.code}</span>
                </p>
                <dl className="grid grid-cols-3 gap-px sm:grid-cols-6">
                  {BUCKETS.map(([label, field]) => (
                    <div key={field} className="px-3 py-2">
                      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
                      <dd>
                        <UnitAmount
                          minutes={row.balance[field]}
                          workdayMinutes={page.workdayMinutes}
                          legalUnit={row.legalUnit}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Log / request</h2>
        <div className="mt-2">
          <LeaveForm
            types={page.types.map((type) => ({
              id: type.id,
              code: type.code,
              name: type.name,
              consumesBalance: type.consumesBalance,
              unlimited: type.unlimited,
              availableMinutes:
                page.balances.find((row) => row.id === type.id)?.balance.availableMinutes ?? 0,
              legalUnit: type.legalUnit,
              minIncrementMinutes: type.minIncrementMinutes,
              negativeAllowed: type.negativeAllowed,
              negativeFloorMinutes: type.negativeFloorMinutes,
            }))}
            holidays={page.holidays}
            weekendDays={page.weekendDays}
            workdayMinutes={page.workdayMinutes}
            today={page.today}
            appReadonly={settings.appReadonly}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">My entries</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-1 pr-3 font-medium">Start</th>
                <th className="py-1 pr-3 font-medium">End</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Portion</th>
                <th className="py-1 pr-3 font-medium">Hours</th>
                <th className="py-1 pr-3 font-medium">Intent</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Note</th>
                <th className="py-1 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {page.entries.length === 0 ? (
                <tr>
                  <td className="py-3 text-zinc-600 dark:text-zinc-400" colSpan={9}>
                    No entries yet.
                  </td>
                </tr>
              ) : (
                page.entries.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1 pr-3 font-mono tabular-nums">{row.startDate}</td>
                    <td className="py-1 pr-3 font-mono tabular-nums">{row.endDate}</td>
                    <td className="py-1 pr-3">{row.leaveTypeName}</td>
                    <td className="py-1 pr-3">{row.portion}</td>
                    <td className="py-1 pr-3">
                      <UnitAmount
                        minutes={row.totalMinutes}
                        workdayMinutes={page.workdayMinutes}
                        legalUnit="hours"
                      />
                    </td>
                    <td className="py-1 pr-3">{row.intent}</td>
                    <td className="py-1 pr-3">{row.status}</td>
                    <td className="max-w-xs truncate py-1" title={row.note ?? ""}>
                      {row.note ?? ""}
                    </td>
                    <td className="py-1">
                      {row.canCancel ? (
                        <CancelEntryButton entryId={row.id} appReadonly={settings.appReadonly} />
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">Ledger</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-1 pr-3 font-medium">Effective</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Kind</th>
                <th className="py-1 pr-3 font-medium">Hours</th>
                <th className="py-1 pr-3 font-medium">Remaining</th>
                <th className="py-1 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {page.ledger.length === 0 ? (
                <tr>
                  <td className="py-3 text-zinc-600 dark:text-zinc-400" colSpan={6}>
                    No ledger rows this year.
                  </td>
                </tr>
              ) : (
                page.ledger.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-zinc-100 dark:border-zinc-900 ${
                      row.reversedAt ? "text-zinc-400 line-through" : ""
                    }`}
                  >
                    <td className="py-1 pr-3 font-mono tabular-nums">{row.effectiveOn}</td>
                    <td className="py-1 pr-3">{row.leaveTypeName}</td>
                    <td className="py-1 pr-3 font-mono">{row.kind}</td>
                    <td className="py-1 pr-3">
                      <UnitAmount
                        minutes={row.minutes}
                        workdayMinutes={page.workdayMinutes}
                        legalUnit="hours"
                      />
                    </td>
                    <td className="py-1 pr-3">
                      {row.remainingMinutes == null ? (
                        "—"
                      ) : (
                        <UnitAmount
                          minutes={row.remainingMinutes}
                          workdayMinutes={page.workdayMinutes}
                          legalUnit="hours"
                        />
                      )}
                    </td>
                    <td className="max-w-xs truncate py-1" title={row.reason ?? ""}>
                      {row.reason ?? ""}
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

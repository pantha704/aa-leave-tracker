import { requireAdmin } from "@/server/auth";

const DOWNLOADS = [
  { kind: "balances", label: "Balances", hint: "One row per employee × consuming type" },
  { kind: "entries", label: "Entries", hint: "Leave logs and requests" },
  { kind: "ledger", label: "Ledger", hint: "Append-only grant, usage, adjustment rows" },
  {
    kind: "termination",
    label: "Termination",
    hint: "Two hour columns: ledger_remaining and pro_rata_earned_to_end_date",
  },
] as const;

export default async function AdminExportPage({ searchParams }: PageProps<"/admin/export">) {
  await requireAdmin();
  const params = await searchParams;
  const date = typeof params.endDate === "string" ? params.endDate : "";
  const query = date ? `?asOf=${encodeURIComponent(date)}&endDate=${encodeURIComponent(date)}` : "";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">CSV export</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Admin-only downloads. Each download is audited. Termination is not a single unused-hours
          column.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 text-sm" action="/admin/export" method="get">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-600 dark:text-zinc-400">As of / end date</span>
          <input
            className="rounded border border-zinc-300 bg-transparent px-2 py-1.5 font-mono dark:border-zinc-700"
            name="endDate"
            type="date"
            defaultValue={date}
          />
        </label>
        <button
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          type="submit"
        >
          Apply
        </button>
      </form>

      <ul className="flex flex-col gap-3 text-sm">
        {DOWNLOADS.map((item) => (
          <li key={item.kind}>
            <a className="underline" href={`/api/admin/export/${item.kind}.csv${query}`}>
              Download {item.label}
            </a>
            <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{item.hint}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

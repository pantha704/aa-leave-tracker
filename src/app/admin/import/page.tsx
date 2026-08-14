import { requireAdmin } from "@/server/auth";
import { dbImportStore } from "@/server/import/commit";
import { LeaveImportForm } from "./import-form";
import { ReverseBatchForm } from "./reverse-batch-form";

export default async function AdminImportPage() {
  const { employee } = await requireAdmin();
  const batches = await dbImportStore.listBatches(employee.orgId);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin">
            Admin
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">CSV import</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Map columns, dry-run, then commit a reversible batch. Opening remaining posts sheet −
          current app remaining as an adjustment, never a lump grant. Import opening remaining or
          the same year&apos;s used days, not both.
        </p>
      </header>

      <LeaveImportForm />

      <section>
        <h2 className="text-lg font-medium">Import batches</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 font-medium">File</th>
                <th className="py-2 pr-4 font-medium">Reversed</th>
                <th className="py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={5}>
                    No import batches yet.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-mono">{batch.createdAt.toISOString()}</td>
                    <td className="py-2 pr-4">{batch.kind}</td>
                    <td className="py-2 pr-4">{batch.filename ?? ""}</td>
                    <td className="py-2 pr-4">{batch.reversedAt ? batch.reversedAt.toISOString() : ""}</td>
                    <td className="py-2">
                      {batch.reversedAt ? null : <ReverseBatchForm batchId={batch.id} />}
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

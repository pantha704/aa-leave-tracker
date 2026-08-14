import { requireAdmin } from "@/server/auth";

export default async function AdminPage() {
  await requireAdmin();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">Placeholder</p>
        <p className="mt-6">
          <a className="text-sm underline" href="/admin/employees/new">
            Create employee
          </a>
        </p>
      </main>
    </div>
  );
}

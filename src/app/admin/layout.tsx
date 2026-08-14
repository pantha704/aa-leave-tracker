import { countPendingEntries } from "@/server/admin/employees";
import { requireAdmin } from "@/server/auth";
import { syncEmailEnabled } from "@/server/notify";
import { AdminEmailBanner } from "./email-banner";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { employee } = await requireAdmin();
  const pendingCount = await countPendingEntries(employee.orgId);
  await syncEmailEnabled(employee.orgId).catch((err) => {
    console.error("org_settings.email_enabled sync failed", err);
  });

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 px-6 py-3 text-sm dark:border-zinc-800">
        <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
          <a className="font-medium" href="/admin">
            Admin
          </a>
          <a className="underline" href="/admin/employees">
            Employees
          </a>
          <a className="underline" href="/admin/holidays">
            Holidays
          </a>
          <a className="underline" href="/admin/leave-types">
            Leave types
          </a>
          <a
            className="ml-auto rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            href="/admin/employees#pending"
            aria-label={`${pendingCount} pending requests`}
          >
            Pending {pendingCount}
          </a>
        </nav>
      </header>
      <AdminEmailBanner />
      {children}
    </div>
  );
}

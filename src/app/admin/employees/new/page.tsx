import { requireAdmin } from "@/server/auth";
import { EmployeeForm } from "./employee-form";

export default async function NewEmployeePage() {
  await requireAdmin();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex w-full flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">New employee</h1>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Creates a roster row and a one-time invite link. There is no public registration.
        </p>
        <EmployeeForm />
      </main>
    </div>
  );
}

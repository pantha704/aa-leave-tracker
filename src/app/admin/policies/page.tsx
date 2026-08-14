import { requireAdmin } from "@/server/auth";
import {
  listAssignments,
  listOrgEmployees,
  listPolicies,
  NEW_POLICY_JSON,
  policyToEditorJson,
} from "@/server/policy/save";
import { AssignPolicyForm, PolicyJsonForm } from "./policy-json-forms";

export default async function AdminPoliciesPage() {
  const { employee } = await requireAdmin();
  const [policyRows, people, assignments] = await Promise.all([
    listPolicies(employee.orgId),
    listOrgEmployees(employee.orgId),
    listAssignments(employee.orgId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <a className="underline" href="/admin">
            Admin
          </a>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Policies</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Paste JSON to change caps. One leave type per policy. Assignments update in place per
          employee+type.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">New policy</h2>
        <PolicyJsonForm json={NEW_POLICY_JSON} />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-medium">Existing policies</h2>
        {policyRows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No policies yet.</p>
        ) : (
          policyRows.map((policy) => (
            <div key={policy.id} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{policy.name}</h3>
              <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">{policy.id}</p>
              <PolicyJsonForm id={policy.id} json={policyToEditorJson(policy)} />
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Assignments</h2>
        <AssignPolicyForm employees={people} policies={policyRows} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Employee</th>
                <th className="py-2 pr-4 font-medium">Policy</th>
                <th className="py-2 pr-4 font-medium">From</th>
                <th className="py-2 font-medium">To</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td className="py-4 text-zinc-600 dark:text-zinc-400" colSpan={4}>
                    No assignments yet.
                  </td>
                </tr>
              ) : (
                assignments.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      {row.employeeName}{" "}
                      <span className="text-zinc-600 dark:text-zinc-400">({row.employeeEmail})</span>
                    </td>
                    <td className="py-2 pr-4">{row.policyName}</td>
                    <td className="py-2 pr-4 font-mono">{row.validFrom}</td>
                    <td className="py-2 font-mono">{row.validTo ?? ""}</td>
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

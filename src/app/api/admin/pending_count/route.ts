import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { countPendingEntries } from "@/server/admin/employees";

export type AdminPendingCountDeps = AdminGateDeps & {
  countPending: (orgId: string) => Promise<number>;
};

const defaultDeps: AdminPendingCountDeps = {
  ...defaultAdminGateDeps,
  countPending: countPendingEntries,
};

export async function getAdminPendingCount(
  request: NextRequest,
  deps: AdminPendingCountDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const pendingCount = await deps.countPending(gate.context.orgId);
  return NextResponse.json({ pendingCount });
}

export async function GET(request: NextRequest) {
  return getAdminPendingCount(request);
}

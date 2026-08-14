import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { listPendingEntries, type PendingEntryRow } from "@/server/admin/employees";

export type AdminEntriesDeps = AdminGateDeps & {
  listPending: (orgId: string) => Promise<PendingEntryRow[]>;
};

const defaultDeps: AdminEntriesDeps = {
  ...defaultAdminGateDeps,
  listPending: listPendingEntries,
};

export async function getAdminEntries(
  request: NextRequest,
  deps: AdminEntriesDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const status = request.nextUrl.searchParams.get("status");
  if (status && status !== "pending") {
    return NextResponse.json({ error: "only status=pending is supported" }, { status: 400 });
  }
  const entries = await deps.listPending(gate.context.orgId);
  return NextResponse.json({ entries });
}

export async function GET(request: NextRequest) {
  return getAdminEntries(request);
}

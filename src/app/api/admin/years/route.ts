import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { listPolicyPeriods } from "@/server/year-end";

export type AdminYearsDeps = AdminGateDeps & {
  list: (orgId: string) => Promise<
    Array<{ year: number; status: string; closedAt: Date | null; closedBy: string | null }>
  >;
};

const defaultDeps: AdminYearsDeps = {
  ...defaultAdminGateDeps,
  list: listPolicyPeriods,
};

export async function getAdminYears(request: NextRequest, deps: AdminYearsDeps = defaultDeps) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const periods = await deps.list(gate.context.orgId);
  return NextResponse.json({ periods });
}

export async function GET(request: NextRequest) {
  return getAdminYears(request);
}

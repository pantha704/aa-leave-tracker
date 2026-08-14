import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { postAdjustment, type AdminFail } from "@/server/admin/employees";
import type { LedgerRow } from "@/server/ledger/post";

export type AdminAdjustDeps = AdminGateDeps & {
  postAdjustment: (input: {
    actor: { id: string; role: "employee" | "manager" | "admin" };
    orgId: string;
    employeeId: string;
    raw: unknown;
  }) => Promise<{ ok: true; row: LedgerRow } | AdminFail>;
};

const defaultDeps: AdminAdjustDeps = {
  ...defaultAdminGateDeps,
  postAdjustment,
};

export async function postAdminAdjustment(
  request: NextRequest,
  employeeId: string,
  deps: AdminAdjustDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const result = await deps.postAdjustment({
    actor: gate.context.actor,
    orgId: gate.context.orgId,
    employeeId,
    raw: body.value,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ledgerEntry: result.row }, { status: 201 });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/adjustments">,
) {
  const { id } = await context.params;
  return postAdminAdjustment(request, id);
}

import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import type { AdminFail } from "@/server/admin/employees";
import { terminateEmployee, type TerminateResult } from "@/server/terminate";
import type { AuthzActor } from "@/server/authz";

export type AdminTerminateDeps = AdminGateDeps & {
  terminate: (input: {
    actor: AuthzActor;
    orgId: string;
    employeeId: string;
    raw: unknown;
  }) => Promise<({ ok: true } & TerminateResult) | AdminFail>;
};

const defaultDeps: AdminTerminateDeps = {
  ...defaultAdminGateDeps,
  terminate: terminateEmployee,
};

export async function postAdminTerminate(
  request: NextRequest,
  employeeId: string,
  deps: AdminTerminateDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const result = await deps.terminate({
    actor: gate.context.actor,
    orgId: gate.context.orgId,
    employeeId,
    raw: body.value,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/terminate">,
) {
  const { id } = await context.params;
  return postAdminTerminate(request, id);
}

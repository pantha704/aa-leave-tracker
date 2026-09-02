import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { assignEmployeePolicy, type AdminFail, type FileAssignment } from "@/server/admin/employees";
import type { AuthzActor } from "@/server/authz";

export type AdminAssignDeps = AdminGateDeps & {
  assign: (input: {
    actor: AuthzActor;
    orgId: string;
    employeeId: string;
    raw: unknown;
  }) => Promise<{ ok: true; assignment: FileAssignment } | AdminFail>;
};

const defaultDeps: AdminAssignDeps = {
  ...defaultAdminGateDeps,
  assign: assignEmployeePolicy,
};

export async function postAdminAssignment(
  request: NextRequest,
  employeeId: string,
  deps: AdminAssignDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const result = await deps.assign({
    actor: gate.context.actor,
    orgId: gate.context.orgId,
    employeeId,
    raw: body.value,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ assignment: result.assignment }, { status: 201 });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/assignments">,
) {
  const { id } = await context.params;
  return postAdminAssignment(request, id);
}

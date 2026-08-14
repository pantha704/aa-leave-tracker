import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  assignPolicy,
  parseAssignmentInput,
  type AssignmentSaveInput,
  type AssignPolicyResult,
} from "@/server/policy/save";

export type AdminPolicyAssignmentDeps = AdminGateDeps & {
  assign: (
    orgId: string,
    input: AssignmentSaveInput,
    actorId: string,
  ) => Promise<AssignPolicyResult>;
};

const defaultDeps: AdminPolicyAssignmentDeps = {
  ...defaultAdminGateDeps,
  assign: assignPolicy,
};

export async function postAdminPolicyAssignment(
  request: NextRequest,
  policyId: string,
  deps: AdminPolicyAssignmentDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const parsed = parseAssignmentInput({ ...body, policy_id: policyId });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.assign(gate.context.orgId, parsed.value, gate.context.actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(
    { assignment: result.assignment, updatedInPlace: result.updatedInPlace },
    { status: result.updatedInPlace ? 200 : 201 },
  );
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/policies/[id]/assignments">,
) {
  const { id } = await context.params;
  return postAdminPolicyAssignment(request, id);
}

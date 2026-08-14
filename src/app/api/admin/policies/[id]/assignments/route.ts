import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
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

  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const payload =
    typeof body.value === "object" && body.value !== null && !Array.isArray(body.value)
      ? { ...(body.value as Record<string, unknown>), policy_id: policyId }
      : { policy_id: policyId };
  const parsed = parseAssignmentInput(payload);
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

import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  parsePolicyInput,
  updatePolicy,
  type PolicySaveInput,
  type SavePolicyResult,
} from "@/server/policy/save";

export type AdminPolicyItemDeps = AdminGateDeps & {
  update: (
    orgId: string,
    id: string,
    input: PolicySaveInput,
    actorId: string,
  ) => Promise<SavePolicyResult>;
};

const defaultDeps: AdminPolicyItemDeps = {
  ...defaultAdminGateDeps,
  update: updatePolicy,
};

export async function patchAdminPolicy(
  request: NextRequest,
  id: string,
  deps: AdminPolicyItemDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const parsed = parsePolicyInput(await request.json());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.update(gate.context.orgId, id, parsed.value, gate.context.actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ policy: result.policy });
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/admin/policies/[id]">,
) {
  const { id } = await context.params;
  return patchAdminPolicy(request, id);
}

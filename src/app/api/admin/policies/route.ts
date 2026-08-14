import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  createPolicy,
  listPolicies,
  parsePolicyInput,
  type PolicyRecord,
  type PolicySaveInput,
  type SavePolicyResult,
} from "@/server/policy/save";

export type AdminPoliciesDeps = AdminGateDeps & {
  list: (orgId: string) => Promise<PolicyRecord[]>;
  create: (orgId: string, input: PolicySaveInput, actorId: string) => Promise<SavePolicyResult>;
};

const defaultDeps: AdminPoliciesDeps = {
  ...defaultAdminGateDeps,
  list: listPolicies,
  create: createPolicy,
};

export async function getAdminPolicies(
  request: NextRequest,
  deps: AdminPoliciesDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const policies = await deps.list(gate.context.orgId);
  return NextResponse.json({ policies });
}

export async function postAdminPolicy(
  request: NextRequest,
  deps: AdminPoliciesDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const parsed = parsePolicyInput(await request.json());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.create(gate.context.orgId, parsed.value, gate.context.actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ policy: result.policy }, { status: 201 });
}

export async function GET(request: NextRequest) {
  return getAdminPolicies(request);
}

export async function POST(request: NextRequest) {
  return postAdminPolicy(request);
}

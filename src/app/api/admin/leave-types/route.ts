import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  createLeaveType,
  listLeaveTypes,
  parseLeaveTypeInput,
  type LeaveTypeInput,
  type LeaveTypeRecord,
  type LeaveTypeWriteOptions,
} from "@/server/leave-types";

export type AdminLeaveTypesDeps = AdminGateDeps & {
  listTypes: (orgId: string) => Promise<LeaveTypeRecord[]>;
  createType: (
    orgId: string,
    input: LeaveTypeInput,
    options?: LeaveTypeWriteOptions,
  ) => Promise<{ ok: true; leaveType: LeaveTypeRecord } | { ok: false; error: string; status: 409 }>;
};

const defaultDeps: AdminLeaveTypesDeps = {
  ...defaultAdminGateDeps,
  listTypes: listLeaveTypes,
  createType: createLeaveType,
};

export async function getAdminLeaveTypes(
  request: NextRequest,
  deps: AdminLeaveTypesDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const types = await deps.listTypes(gate.context.orgId);
  return NextResponse.json({ leaveTypes: types });
}

export async function postAdminLeaveType(
  request: NextRequest,
  deps: AdminLeaveTypesDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const parsed = parseLeaveTypeInput(body.value);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.createType(gate.context.orgId, parsed.value, {
    actorId: gate.context.actor.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ leaveType: result.leaveType }, { status: 201 });
}

export async function GET(request: NextRequest) {
  return getAdminLeaveTypes(request);
}

export async function POST(request: NextRequest) {
  return postAdminLeaveType(request);
}

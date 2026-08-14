import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  deleteLeaveType,
  parseLeaveTypeInput,
  updateLeaveType,
  type LeaveTypeInput,
  type LeaveTypeRecord,
} from "@/server/leave-types";

export type AdminLeaveTypeItemDeps = AdminGateDeps & {
  updateType: (
    orgId: string,
    id: string,
    input: LeaveTypeInput,
  ) => Promise<
    { ok: true; leaveType: LeaveTypeRecord } | { ok: false; error: string; status: 404 | 409 }
  >;
  deleteType: (
    orgId: string,
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string; status: 404 | 409 }>;
};

const defaultDeps: AdminLeaveTypeItemDeps = {
  ...defaultAdminGateDeps,
  updateType: updateLeaveType,
  deleteType: deleteLeaveType,
};

export async function patchAdminLeaveType(
  request: NextRequest,
  id: string,
  deps: AdminLeaveTypeItemDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const parsed = parseLeaveTypeInput(await request.json());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.updateType(gate.context.orgId, id, parsed.value);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ leaveType: result.leaveType });
}

export async function deleteAdminLeaveType(
  request: NextRequest,
  id: string,
  deps: AdminLeaveTypeItemDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const result = await deps.deleteType(gate.context.orgId, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/admin/leave-types/[id]">,
) {
  const { id } = await context.params;
  return patchAdminLeaveType(request, id);
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/admin/leave-types/[id]">,
) {
  const { id } = await context.params;
  return deleteAdminLeaveType(request, id);
}

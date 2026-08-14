import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  deleteLeaveType,
  parseLeaveTypeInput,
  updateLeaveType,
  type LeaveTypeInput,
  type LeaveTypeRecord,
  type LeaveTypeWriteFail,
  type LeaveTypeWriteOptions,
} from "@/server/leave-types";

export type AdminLeaveTypeItemDeps = AdminGateDeps & {
  updateType: (
    orgId: string,
    id: string,
    input: LeaveTypeInput,
    options?: LeaveTypeWriteOptions,
  ) => Promise<{ ok: true; leaveType: LeaveTypeRecord } | LeaveTypeWriteFail>;
  deleteType: (
    orgId: string,
    id: string,
    options?: LeaveTypeWriteOptions,
  ) => Promise<{ ok: true } | LeaveTypeWriteFail>;
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

  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }

  const parsed = parseLeaveTypeInput(body.value);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await deps.updateType(gate.context.orgId, id, parsed.value, {
    actorId: gate.context.actor.id,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
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

  const result = await deps.deleteType(gate.context.orgId, id, {
    actorId: gate.context.actor.id,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
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

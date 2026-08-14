import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { writeAuditEvent } from "@/server/audit";
import { deleteHoliday } from "@/server/holidays/import";

export type AdminHolidayItemDeps = AdminGateDeps & {
  removeHoliday: typeof deleteHoliday;
};

const defaultDeps: AdminHolidayItemDeps = {
  ...defaultAdminGateDeps,
  removeHoliday: deleteHoliday,
};

export async function deleteAdminHoliday(
  request: NextRequest,
  id: string,
  deps: AdminHolidayItemDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const result = await deps.removeHoliday(gate.context.orgId, id, {
    actorId: gate.context.actor.id,
    writeAudit: writeAuditEvent,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/admin/holidays/[id]">,
) {
  const { id } = await context.params;
  return deleteAdminHoliday(request, id);
}

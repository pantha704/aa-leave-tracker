import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { buildExport, type BuildExportInput, type BuildExportResult } from "@/server/export";
import { parseExportKind } from "@/server/export/kinds";

export type AdminExportDeps = AdminGateDeps & {
  build: (input: BuildExportInput) => Promise<BuildExportResult>;
  writeAudit?: AuditWriter;
};

const defaultDeps: AdminExportDeps = {
  ...defaultAdminGateDeps,
  build: buildExport,
  writeAudit: writeAuditEvent,
};

export async function getAdminExport(
  request: NextRequest,
  kindParam: string,
  deps: AdminExportDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const kind = parseExportKind(kindParam);
  if (!kind) {
    return NextResponse.json({ error: "unknown export kind" }, { status: 400 });
  }

  const asOf = request.nextUrl.searchParams.get("asOf") ?? undefined;
  const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined;
  const employeeId = request.nextUrl.searchParams.get("employeeId") ?? undefined;

  const result = await deps.build({
    orgId: gate.context.orgId,
    kind,
    asOf,
    endDate,
    employeeId: employeeId || undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await tryWriteAudit(deps.writeAudit ?? writeAuditEvent, {
    actorId: gate.context.actor.id,
    action: `export.${kind}.download`,
    entityType: "export",
    entityId: gate.context.orgId,
    after: { kind, filename: result.filename, rowCount: result.rowCount, employeeId: employeeId || null },
  });

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.filename}"`,
    },
  });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/export/[kind]">,
) {
  const { kind } = await context.params;
  return getAdminExport(request, kind);
}

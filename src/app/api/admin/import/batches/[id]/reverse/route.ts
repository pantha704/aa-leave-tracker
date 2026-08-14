import { NextRequest, NextResponse } from "next/server";
import { defaultAdminGateDeps, requireAdminApi, type AdminGateDeps } from "@/server/admin-api";
import {
  dbImportStore,
  reverseImportBatch,
  type ImportCommitStore,
  type ReverseImportResult,
} from "@/server/import/commit";

export type AdminImportReverseDeps = AdminGateDeps & {
  reverse: typeof reverseImportBatch;
  store: ImportCommitStore;
};

const defaultDeps: AdminImportReverseDeps = {
  ...defaultAdminGateDeps,
  reverse: reverseImportBatch,
  store: dbImportStore,
};

export async function postAdminImportReverse(
  request: NextRequest,
  batchId: string,
  deps: AdminImportReverseDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const result: ReverseImportResult = await deps.reverse(
    { orgId: gate.context.orgId, batchId, actor: gate.context.actor },
    deps.store,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({
    batch: result.batch,
    reversedLedger: result.reversedLedger,
    cancelledEntries: result.cancelledEntries,
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/import/batches/[id]/reverse">,
) {
  const { id } = await context.params;
  return postAdminImportReverse(request, id);
}

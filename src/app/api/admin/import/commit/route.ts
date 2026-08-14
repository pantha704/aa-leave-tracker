import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  commitImport,
  dbImportStore,
  type CommitImportResult,
  type ImportCommitStore,
} from "@/server/import/commit";
import { parseColumnMap, parseImportKind } from "../preview/route";

export type AdminImportCommitDeps = AdminGateDeps & {
  commit: typeof commitImport;
  store: ImportCommitStore;
};

const defaultDeps: AdminImportCommitDeps = {
  ...defaultAdminGateDeps,
  commit: commitImport,
  store: dbImportStore,
};

export async function postAdminImportCommit(
  request: NextRequest,
  deps: AdminImportCommitDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const record = body.value as Record<string, unknown>;
  const kind = parseImportKind(record.kind);
  const csv = typeof record.csv === "string" ? record.csv : null;
  if (!kind) return NextResponse.json({ error: "kind must be opening or entries" }, { status: 400 });
  if (csv == null) return NextResponse.json({ error: "csv is required" }, { status: 400 });

  const result: CommitImportResult = await deps.commit(
    {
      orgId: gate.context.orgId,
      actor: gate.context.actor,
      kind,
      csv,
      map: parseColumnMap(record.map),
      filename: typeof record.filename === "string" ? record.filename : null,
    },
    deps.store,
  );
  if (!result.ok) {
    if ("status" in result) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({ error: "csv_errors", ...result.dryRun }, { status: 400 });
  }
  return NextResponse.json({
    batch: result.batch,
    posted: result.posted,
    entries: result.entries,
    diffs: result.dryRun.diffs,
  });
}

export async function POST(request: NextRequest) {
  return postAdminImportCommit(request);
}

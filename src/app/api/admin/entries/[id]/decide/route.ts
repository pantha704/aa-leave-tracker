import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  findLeaveEntryInOrg,
  isUuid,
  type LeaveEntryOrgRef,
} from "@/server/admin/employees";
import {
  decideLeave,
  type DecideAction,
  type DecideLeaveInput,
  type DecideLeaveSuccess,
} from "@/server/leave/decide";
import type { LeaveFail } from "@/server/leave/submit";

const ACTIONS = new Set<DecideAction>(["approve", "reject", "cancel"]);

export type AdminDecideDeps = AdminGateDeps & {
  resolveEntry: (orgId: string, entryId: string) => Promise<LeaveEntryOrgRef | null>;
  decide: (input: DecideLeaveInput) => Promise<DecideLeaveSuccess | LeaveFail>;
};

const defaultDeps: AdminDecideDeps = {
  ...defaultAdminGateDeps,
  resolveEntry: findLeaveEntryInOrg,
  decide: (input) => decideLeave(input),
};

export async function postAdminDecide(
  request: NextRequest,
  entryId: string,
  deps: AdminDecideDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  if (typeof body.value !== "object" || body.value === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const raw = body.value as Record<string, unknown>;
  const action = raw.action;
  if (typeof action !== "string" || !ACTIONS.has(action as DecideAction)) {
    return NextResponse.json({ error: "action must be approve, reject, or cancel" }, { status: 400 });
  }
  const adminNote = typeof raw.adminNote === "string" ? raw.adminNote : undefined;
  const override = raw.override === true;

  if (!isUuid(entryId)) {
    return NextResponse.json({ error: "leave entry not found" }, { status: 404 });
  }
  const scoped = await deps.resolveEntry(gate.context.orgId, entryId);
  if (!scoped) {
    return NextResponse.json({ error: "leave entry not found" }, { status: 404 });
  }

  const result = await deps.decide({
    actor: gate.context.actor,
    entryId,
    action: action as DecideAction,
    adminNote,
    override,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  return NextResponse.json({
    action: result.action,
    entry: result.entry,
    ledgerPosted: result.ledgerPosted,
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/entries/[id]/decide">,
) {
  const { id } = await context.params;
  return postAdminDecide(request, id);
}

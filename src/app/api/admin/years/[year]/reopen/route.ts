import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { reopenYear, type YearEndResult } from "@/server/year-end";

export type ReopenYearDeps = AdminGateDeps & {
  reopen: (
    orgId: string,
    year: number,
    actorId: string,
  ) => Promise<YearEndResult & { reversed?: number }>;
};

const defaultDeps: ReopenYearDeps = {
  ...defaultAdminGateDeps,
  reopen: reopenYear,
};

function parseYearParam(year: string): number | null {
  const value = Number(year);
  if (!Number.isInteger(value)) return null;
  return value;
}

export async function postAdminYearReopen(
  request: NextRequest,
  yearParam: string,
  deps: ReopenYearDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const year = parseYearParam(yearParam);
  if (year == null) {
    return NextResponse.json({ error: "year must be an integer" }, { status: 400 });
  }
  const result = await deps.reopen(gate.context.orgId, year, gate.context.actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ year, reversed: result.reversed ?? 0 });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/years/[year]/reopen">,
) {
  const { year } = await context.params;
  return postAdminYearReopen(request, year);
}

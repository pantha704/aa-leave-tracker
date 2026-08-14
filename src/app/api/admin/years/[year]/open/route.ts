import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import { openFirstYear, type YearEndResult } from "@/server/year-end";

export type OpenYearDeps = AdminGateDeps & {
  open: (orgId: string, year: number, actorId: string) => Promise<YearEndResult & { posts?: number }>;
};

const defaultDeps: OpenYearDeps = {
  ...defaultAdminGateDeps,
  open: openFirstYear,
};

function parseYearParam(year: string): number | null {
  const value = Number(year);
  if (!Number.isInteger(value)) return null;
  return value;
}

export async function postAdminYearOpen(
  request: NextRequest,
  yearParam: string,
  deps: OpenYearDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const year = parseYearParam(yearParam);
  if (year == null) {
    return NextResponse.json({ error: "year must be an integer" }, { status: 400 });
  }
  const result = await deps.open(gate.context.orgId, year, gate.context.actor.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ year, posts: result.posts ?? 0 });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/years/[year]/open">,
) {
  const { year } = await context.params;
  return postAdminYearOpen(request, year);
}

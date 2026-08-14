import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  readJsonBody,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  closeYear,
  parseCalendarYear,
  type ClosePlan,
  type CloseYearOptions,
  type YearEndResult,
} from "@/server/year-end";

export type CloseYearDeps = AdminGateDeps & {
  close: (
    orgId: string,
    year: number,
    actorId: string,
    options?: CloseYearOptions,
  ) => Promise<YearEndResult & { plan?: ClosePlan; snapshot?: { sha256: string; path: string } }>;
};

const defaultDeps: CloseYearDeps = {
  ...defaultAdminGateDeps,
  close: closeYear,
};

function parseYearParam(year: string): number | null {
  return parseCalendarYear(year);
}

export async function postAdminYearClose(
  request: NextRequest,
  yearParam: string,
  deps: CloseYearDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const year = parseYearParam(yearParam);
  if (year == null) {
    return NextResponse.json({ error: "year must be an integer" }, { status: 400 });
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: 400 });
  }
  const raw = body.value;
  const acknowledgeForfeit =
    typeof raw === "object" &&
    raw !== null &&
    "acknowledge_forfeit" in raw &&
    Boolean((raw as { acknowledge_forfeit?: unknown }).acknowledge_forfeit);

  const result = await deps.close(gate.context.orgId, year, gate.context.actor.id, {
    acknowledgeForfeit,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    year,
    nextYear: year + 1,
    snapshot: result.snapshot ?? null,
    preview: result.plan?.preview ?? [],
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/years/[year]/close">,
) {
  const { year } = await context.params;
  return postAdminYearClose(request, year);
}

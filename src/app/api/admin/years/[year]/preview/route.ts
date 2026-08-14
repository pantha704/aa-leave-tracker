import { NextRequest, NextResponse } from "next/server";
import {
  defaultAdminGateDeps,
  requireAdminApi,
  type AdminGateDeps,
} from "@/server/admin-api";
import {
  parseCalendarYear,
  previewCloseYear,
  type ClosePlan,
  type CloseYearOptions,
} from "@/server/year-end";

export type PreviewYearDeps = AdminGateDeps & {
  preview: (
    orgId: string,
    year: number,
    options?: CloseYearOptions,
  ) => Promise<{ ok: true; plan: ClosePlan } | { ok: false; error: string; status: 400 }>;
};

const defaultDeps: PreviewYearDeps = {
  ...defaultAdminGateDeps,
  preview: previewCloseYear,
};

export function parseYearParam(year: string): number | null {
  return parseCalendarYear(year);
}

export async function getAdminYearPreview(
  request: NextRequest,
  yearParam: string,
  deps: PreviewYearDeps = defaultDeps,
) {
  const gate = await requireAdminApi(request, deps);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  const year = parseYearParam(yearParam);
  if (year == null) {
    return NextResponse.json({ error: "year must be an integer" }, { status: 400 });
  }
  const acknowledge = request.nextUrl.searchParams.get("acknowledge_forfeit") === "true";
  const result = await deps.preview(gate.context.orgId, year, { acknowledgeForfeit: acknowledge });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ year, preview: result.plan.preview, posts: result.plan.posts });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/admin/years/[year]/preview">,
) {
  const { year } = await context.params;
  return getAdminYearPreview(request, year);
}

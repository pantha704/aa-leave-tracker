import { NextRequest, NextResponse } from "next/server";
import { getAuthzActor } from "@/server/auth";
import {
  defaultCalendarStore,
  monthEnd,
  monthStart,
  parseCalendarMonth,
  parseCalendarRange,
  readTeamCalendar,
  type CalendarStore,
} from "@/server/calendar";
import { loadActorOrgId } from "@/server/admin-api";
import type { AuthzActor } from "@/server/authz";

export type CalendarRouteDeps = {
  getAuthzActor: (request: NextRequest) => Promise<AuthzActor | null>;
  loadOrgId: (actorId: string) => Promise<string | null>;
  store: CalendarStore;
};

const defaultDeps: CalendarRouteDeps = {
  getAuthzActor,
  loadOrgId: loadActorOrgId,
  store: defaultCalendarStore,
};

export async function getTeamCalendar(request: NextRequest, deps: CalendarRouteDeps = defaultDeps) {
  const actor = await deps.getAuthzActor(request);
  if (!actor) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const orgId = await deps.loadOrgId(actor.id);
  if (!orgId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = request.nextUrl;
  const fromParam = url.searchParams.get("from") ?? undefined;
  const toParam = url.searchParams.get("to") ?? undefined;
  let from = fromParam;
  let to = toParam;

  if (!from || !to) {
    const ctx = await deps.store.loadOrgContext(orgId);
    const parsed = parseCalendarMonth(
      url.searchParams.get("year") ?? undefined,
      url.searchParams.get("month") ?? undefined,
      ctx?.timezone ?? "UTC",
    );
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    from = monthStart(parsed.year, parsed.month);
    to = monthEnd(parsed.year, parsed.month);
  } else {
    const range = parseCalendarRange(from, to);
    if ("error" in range) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
  }

  const result = await readTeamCalendar({
    actor,
    orgId,
    from: from!,
    to: to!,
    store: deps.store,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: NextRequest) {
  return getTeamCalendar(request);
}

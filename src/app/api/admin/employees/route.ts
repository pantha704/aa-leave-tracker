import { NextRequest, NextResponse } from "next/server";
import { getRosterActor, type RosterActor } from "@/server/auth";
import {
  createEmployeeWithInvite,
  defaultInviteDeps,
  type CreateEmployeeResult,
  type InviteDeps,
} from "@/server/invite";

export type AdminEmployeesDeps = {
  getRosterActor: (request: NextRequest) => Promise<RosterActor | null>;
  invite: InviteDeps;
};

function resolveDeps(deps?: AdminEmployeesDeps): AdminEmployeesDeps {
  return deps ?? { getRosterActor, invite: defaultInviteDeps() };
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export async function postAdminEmployees(
  request: NextRequest,
  deps?: AdminEmployeesDeps,
): Promise<NextResponse> {
  const resolved = resolveDeps(deps);
  const actor = await resolved.getRosterActor(request);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const result: CreateEmployeeResult = await createEmployeeWithInvite(
    {
      actor,
      name: field(body, "name"),
      email: field(body, "email"),
      startDate: field(body, "startDate"),
      role: field(body, "role") || undefined,
    },
    resolved.invite,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      employeeId: result.employeeId,
      invitePath: result.invitePath,
    },
    { status: 201 },
  );
}

export async function POST(request: NextRequest) {
  return postAdminEmployees(request);
}

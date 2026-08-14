import { NextRequest, NextResponse } from "next/server";
import { getRosterActor, type RosterActor } from "@/server/auth";
import { defaultInviteDeps, issueInvite, type InviteDeps } from "@/server/invite";

export type AdminInviteDeps = {
  getRosterActor: (request: NextRequest) => Promise<RosterActor | null>;
  invite: InviteDeps;
};

function resolveDeps(deps?: AdminInviteDeps): AdminInviteDeps {
  return deps ?? { getRosterActor, invite: defaultInviteDeps() };
}

export async function postAdminEmployeeInvite(
  request: NextRequest,
  employeeId: string,
  deps?: AdminInviteDeps,
): Promise<NextResponse> {
  const resolved = resolveDeps(deps);
  const actor = await resolved.getRosterActor(request);
  const result = await issueInvite({ actor, employeeId }, resolved.invite);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      employeeId: result.employeeId,
      invitePath: result.invitePath,
      inviteUrl: new URL(result.invitePath, request.nextUrl.origin).href,
    },
    { status: 201 },
  );
}

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/admin/employees/[id]/invite">,
) {
  const { id } = await context.params;
  return postAdminEmployeeInvite(request, id);
}

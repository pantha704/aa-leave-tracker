import { NextRequest } from "next/server";
import { applyAuthGate } from "@/server/auth-gate";
import { getRequestActor } from "@/server/auth";
import { getSessionCookie } from "better-auth/cookies";
import { getDatabaseUrl } from "@/server/db";
import { defaultInviteDeps } from "@/server/invite";
import { gateInvitePath } from "@/server/invite-http";

export async function proxy(request: NextRequest) {
  if (getDatabaseUrl()) {
    const inviteRes = await gateInvitePath(request.nextUrl.pathname, defaultInviteDeps());
    if (inviteRes) return inviteRes;
  }

  const sessionCookie = getSessionCookie(request);
  const actor = sessionCookie
    ? await getRequestActor(request)
    : { kind: "anonymous" as const };
  return applyAuthGate(request, actor);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

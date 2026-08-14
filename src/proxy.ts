import { NextRequest } from "next/server";
import { applyAuthGate } from "@/server/auth-gate";
import { getRequestActor } from "@/server/auth";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
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

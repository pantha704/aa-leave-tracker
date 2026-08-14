import { NextRequest, NextResponse } from "next/server";
import { applyAuthGate } from "@/server/auth-gate";
import { getRequestActor } from "@/server/auth";
import { contentSecurityPolicy } from "@/server/csp";
import { getSessionCookie } from "better-auth/cookies";
import { getDatabaseUrl } from "@/server/db";
import { defaultInviteDeps } from "@/server/invite";
import { gateInvitePath } from "@/server/invite-http";

function withCsp(response: NextResponse, nonce: string, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy({ nonce });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const nextRequest = new NextRequest(request, { headers: requestHeaders });

  if (getDatabaseUrl()) {
    const inviteRes = await gateInvitePath(nextRequest.nextUrl.pathname, defaultInviteDeps());
    if (inviteRes) return withCsp(inviteRes, nonce, csp);
  }

  const sessionCookie = getSessionCookie(nextRequest);
  const actor = sessionCookie
    ? await getRequestActor(nextRequest)
    : { kind: "anonymous" as const };
  return withCsp(applyAuthGate(nextRequest, actor), nonce, csp);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

import { NextRequest } from "next/server";
import { applyAuthGate } from "@/server/auth-gate";
import { getRequestActor } from "@/server/auth";
import { contentSecurityPolicy } from "@/server/csp";
import { getSessionCookie } from "better-auth/cookies";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy({ nonce });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const nextRequest = new NextRequest(request, { headers: requestHeaders });

  const sessionCookie = getSessionCookie(nextRequest);
  const actor = sessionCookie
    ? await getRequestActor(nextRequest)
    : { kind: "anonymous" as const };
  const response = applyAuthGate(nextRequest, actor);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

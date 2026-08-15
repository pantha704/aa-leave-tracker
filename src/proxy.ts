import { NextRequest, NextResponse } from "next/server";
import { applyAuthGate } from "@/server/auth-gate";
import { contentSecurityPolicy } from "@/server/csp";
import { getSessionCookie } from "better-auth/cookies";

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

  // Cookie-only anonymous gate. Role checks stay in pages so postgres stays off the Edge bundle.
  const sessionCookie = getSessionCookie(nextRequest);
  if (sessionCookie) {
    return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), nonce, csp);
  }
  return withCsp(applyAuthGate(nextRequest, { kind: "anonymous" }), nonce, csp);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};

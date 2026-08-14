import { getAuth } from "@/server/auth";
import { clientIpFromHeaders, consumeLoginAttempt } from "@/server/rate-limit";

const handler = (request: Request) => getAuth().handler(request);

function isSignInPath(pathname: string): boolean {
  return pathname === "/api/auth/sign-in/email" || pathname.startsWith("/api/auth/sign-in/");
}

export const GET = handler;

export async function POST(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (isSignInPath(pathname)) {
    const limited = consumeLoginAttempt(clientIpFromHeaders(request.headers));
    if (!limited.ok) {
      return Response.json(
        { message: "Too many login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
      );
    }
  }
  return handler(request);
}

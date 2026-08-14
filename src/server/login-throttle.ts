import {
  clientIpFromHeaders,
  consumeLoginAttempt,
  loginThrottleMessage,
  resetLoginAttempts,
} from "./rate-limit";

export function isSignInPath(pathname: string): boolean {
  return pathname === "/api/auth/sign-in/email" || pathname.startsWith("/api/auth/sign-in/");
}

export function isSuccessfulSignIn(response: Response): boolean {
  return response.status >= 200 && response.status < 300;
}

export async function withLoginRateLimit(
  request: Request,
  next: (request: Request) => Promise<Response> | Response,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "POST" || !isSignInPath(pathname)) {
    return next(request);
  }

  const ip = clientIpFromHeaders(request.headers);
  const limited = consumeLoginAttempt(ip);
  if (!limited.ok) {
    return Response.json(
      { message: loginThrottleMessage(limited.retryAfterSec) },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const response = await next(request);
  if (isSuccessfulSignIn(response)) {
    resetLoginAttempts(ip);
  }
  return response;
}

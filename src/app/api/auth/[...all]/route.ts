import { getAuth } from "@/server/auth";
import { withLoginRateLimit } from "@/server/login-throttle";

const handler = (request: Request) => getAuth().handler(request);

export const GET = handler;

export async function POST(request: Request) {
  return withLoginRateLimit(request, handler);
}

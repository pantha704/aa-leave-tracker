import { getAuth } from "@/server/auth";

const handler = (request: Request) => getAuth().handler(request);

export const GET = handler;
export const POST = handler;

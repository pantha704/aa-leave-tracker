import { NextResponse } from "next/server";

/** Process is up. Does not check Postgres. */
export async function GET() {
  return NextResponse.json({ ok: true, live: true });
}

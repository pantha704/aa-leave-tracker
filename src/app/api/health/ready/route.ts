import { NextResponse } from "next/server";
import { getDatabaseUrl, pingDatabase } from "@/server/db";

/** Ready only when DATABASE_URL is set and Postgres answers. */
export async function GET() {
  const url = getDatabaseUrl();
  if (!url) {
    return NextResponse.json({ ok: false, ready: false, db: "missing" as const }, { status: 503 });
  }
  const up = await pingDatabase(url);
  if (!up) {
    return NextResponse.json({ ok: false, ready: false, db: "down" as const }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ready: true, db: "up" as const });
}

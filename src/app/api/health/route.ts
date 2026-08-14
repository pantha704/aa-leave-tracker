import { NextResponse } from "next/server";
import { getDatabaseUrl, pingDatabase } from "@/server/db";

export async function GET() {
  const url = getDatabaseUrl();
  if (!url) {
    return NextResponse.json({ ok: true, db: "skipped" as const });
  }

  const up = await pingDatabase(url);
  return NextResponse.json({ ok: true, db: up ? ("up" as const) : ("down" as const) });
}

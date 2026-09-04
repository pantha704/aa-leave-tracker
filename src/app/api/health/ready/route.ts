import { NextResponse } from "next/server";
import { getDatabaseUrl, pingDatabase } from "@/server/db";
import { privilegedMfaConfigured } from "@/server/mfa";
import { durableRateLimitConfigured } from "@/server/rate-limit";

/** Ready only when DATABASE_URL is set, Postgres answers, and prod MFA is configured. */
export async function GET() {
  if (!privilegedMfaConfigured()) {
    return NextResponse.json(
      { ok: false, ready: false, mfa: "missing" as const },
      { status: 503 },
    );
  }
  if (!durableRateLimitConfigured()) {
    return NextResponse.json(
      { ok: false, ready: false, rateLimit: "in-process" as const },
      { status: 503 },
    );
  }
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

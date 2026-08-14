import { NextResponse } from "next/server";
import { previewInvite, type InviteDeps } from "./invite";

export function inviteTokenFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inviteUnavailableResponse(status: 404 | 410, message: string): NextResponse {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Accept invite</title></head><body><main><h1>Accept invite</h1><p role="alert">${escapeHtml(message)}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function gateInvitePath(
  pathname: string,
  deps: InviteDeps,
): Promise<NextResponse | null> {
  const token = inviteTokenFromPath(pathname);
  if (!token) return null;
  const preview = await previewInvite(token, deps);
  if (preview.ok) return null;
  return inviteUnavailableResponse(preview.status, preview.error);
}

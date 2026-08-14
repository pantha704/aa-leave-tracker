/** In-memory login throttle. Per-process only; not shared across instances. */

export const LOGIN_RATE_LIMIT_MAX = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

export function clientIpFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

export function consumeLoginAttempt(
  ip: string,
  now = Date.now(),
  max = LOGIN_RATE_LIMIT_MAX,
  windowMs = LOGIN_RATE_LIMIT_WINDOW_MS,
): RateLimitDecision {
  const key = ip.trim() || "unknown";
  pruneIfNeeded(now);
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterSec: retryAfterSec(existing.resetAt, now) };
  }
  existing.count += 1;
  return { ok: true };
}

export function resetLoginAttempts(ip: string): void {
  buckets.delete(ip.trim() || "unknown");
}

export function clearLoginRateLimits(): void {
  buckets.clear();
}

function retryAfterSec(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function pruneIfNeeded(now: number): void {
  if (buckets.size < 256) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

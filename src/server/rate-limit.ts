import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** In-memory login throttle. Per-process only; not shared across instances or serverless isolates. */

export const LOGIN_RATE_LIMIT_MAX = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX_KEYS = 1024;

export type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

export type ClientIpEnv = {
  TRUST_PROXY?: string | undefined;
};

function isTrustedProxy(env: ClientIpEnv): boolean {
  const raw = env.TRUST_PROXY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Identify the client for throttling.
 * Client-supplied `X-Forwarded-For` / `X-Real-IP` are ignored unless `TRUST_PROXY=1`.
 * When a connecting address is known, it wins over any spoofed leftmost XFF hop.
 * With `TRUST_PROXY=1` and no connecting address, use the rightmost XFF hop
 * (the one a trusted reverse proxy appends).
 */
export function clientIpFromHeaders(
  h: Headers,
  env: ClientIpEnv = process.env as ClientIpEnv,
  connectingIp?: string,
): string {
  const peer = connectingIp?.trim();
  if (peer) return peer;

  if (isTrustedProxy(env)) {
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const last = hops[hops.length - 1];
      if (last) return last;
    }
    const real = h.get("x-real-ip")?.trim();
    if (real) return real;
  }

  return "direct";
}

export function consumeLoginAttempt(
  ip: string,
  now = Date.now(),
  max = LOGIN_RATE_LIMIT_MAX,
  windowMs = LOGIN_RATE_LIMIT_WINDOW_MS,
): RateLimitDecision {
  const key = ip.trim() || "direct";
  pruneExpired(now);
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    evictOldestIfFull();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterSec: retryAfterSec(existing.resetAt, now) };
  }
  existing.count += 1;
  return { ok: true };
}

export function consumeLoginAttemptOn(
  store: Map<string, Bucket>,
  ip: string,
  now = Date.now(),
  max = LOGIN_RATE_LIMIT_MAX,
  windowMs = LOGIN_RATE_LIMIT_WINDOW_MS,
): RateLimitDecision {
  const key = ip.trim() || "direct";
  for (const [k, bucket] of store) {
    if (now >= bucket.resetAt) store.delete(k);
  }
  const existing = store.get(key);
  if (!existing || now >= existing.resetAt) {
    while (store.size >= LOGIN_RATE_LIMIT_MAX_KEYS) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterSec: retryAfterSec(existing.resetAt, now) };
  }
  existing.count += 1;
  return { ok: true };
}

export function persistRateLimitStore(filePath: string, store: Map<string, Bucket>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(Object.fromEntries(store)), "utf8");
}

export function loadRateLimitStore(filePath: string): Map<string, Bucket> {
  const store = new Map<string, Bucket>();
  if (!existsSync(filePath)) return store;
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, Bucket>;
  for (const [key, bucket] of Object.entries(raw)) store.set(key, bucket);
  return store;
}

export function consumeDurableLoginAttempt(
  ip: string,
  now = Date.now(),
  filePath = process.env.LOGIN_RATE_LIMIT_FILE?.trim() || "",
): RateLimitDecision {
  if (!filePath) return consumeLoginAttempt(ip, now);
  const store = loadRateLimitStore(filePath);
  const decision = consumeLoginAttemptOn(store, ip, now);
  persistRateLimitStore(filePath, store);
  return decision;
}

export function durableRateLimitConfigured(
  env: Partial<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return Boolean(env.LOGIN_RATE_LIMIT_FILE?.trim() || env.LOGIN_RATE_LIMIT_DB === "1");
}

export function resetLoginAttempts(ip: string): void {
  buckets.delete(ip.trim() || "direct");
}

export function clearLoginRateLimits(): void {
  buckets.clear();
}

export function loginRateLimitSize(): number {
  return buckets.size;
}

export function loginThrottleMessage(retryAfterSec: number): string {
  return `Too many login attempts. Try again in ${retryAfterSec}s.`;
}

function retryAfterSec(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

function evictOldestIfFull(): void {
  while (buckets.size >= LOGIN_RATE_LIMIT_MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

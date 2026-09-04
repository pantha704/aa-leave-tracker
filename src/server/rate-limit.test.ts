import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLoginRateLimit } from "./login-throttle";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOGIN_RATE_LIMIT_MAX_KEYS,
  clearLoginRateLimits,
  clientIpFromHeaders,
  consumeDurableLoginAttempt,
  consumeLoginAttempt,
  consumeLoginThrottle,
  durableRateLimitConfigured,
  loginRateLimitSize,
  loginThrottleMessage,
  resetLoginAttempts,
  resetLoginThrottle,
} from "./rate-limit";

afterEach(() => {
  clearLoginRateLimits();
});

describe("clientIpFromHeaders", () => {
  it("ignores spoofed X-Forwarded-For when TRUST_PROXY is unset", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.9, 10.0.0.1 ",
      "x-real-ip": "10.0.0.2",
    });
    expect(clientIpFromHeaders(headers, {})).toBe("direct");
  });

  it("does not use a spoofed leftmost hop when a connecting address exists", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-real-ip": "10.0.0.2",
    });
    expect(clientIpFromHeaders(headers, {}, "198.51.100.4")).toBe("198.51.100.4");
    expect(clientIpFromHeaders(headers, { TRUST_PROXY: "1" }, "198.51.100.4")).toBe(
      "198.51.100.4",
    );
  });

  it("uses the rightmost X-Forwarded-For hop when TRUST_PROXY is set", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.9, 10.0.0.1 ",
    });
    expect(clientIpFromHeaders(headers, { TRUST_PROXY: "1" })).toBe("10.0.0.1");
  });

  it("falls back to x-real-ip then direct when TRUST_PROXY is set", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }), { TRUST_PROXY: "true" }),
    ).toBe("198.51.100.4");
    expect(clientIpFromHeaders(new Headers(), { TRUST_PROXY: "1" })).toBe("direct");
  });
});

describe("login rate limit", () => {
  it("allows up to max attempts then blocks until the window resets", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      expect(consumeLoginAttempt("1.2.3.4", now, 10, 60_000)).toEqual({ ok: true });
    }
    expect(consumeLoginAttempt("1.2.3.4", now + 1, 10, 60_000)).toEqual({
      ok: false,
      retryAfterSec: 60,
    });
    expect(consumeLoginAttempt("9.9.9.9", now, 10, 60_000)).toEqual({ ok: true });
    expect(consumeLoginAttempt("1.2.3.4", now + 60_000, 10, 60_000)).toEqual({ ok: true });
  });

  it("reset clears a successful IP", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      consumeLoginAttempt("5.5.5.5", now, 10, 60_000);
    }
    resetLoginAttempts("5.5.5.5");
    expect(consumeLoginAttempt("5.5.5.5", now, 10, 60_000)).toEqual({ ok: true });
  });

  it("caps distinct keys so spoofed identities cannot grow the map without bound", () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_KEYS + 50; i++) {
      consumeLoginAttempt(`10.0.0.${i}`, now, 10, 60_000);
    }
    expect(loginRateLimitSize()).toBeLessThanOrEqual(LOGIN_RATE_LIMIT_MAX_KEYS);
  });

  it("formats a retry message with seconds", () => {
    expect(loginThrottleMessage(42)).toBe("Too many login attempts. Try again in 42s.");
  });

  it("persists attempts to a file store and requires a durable config in production", () => {
    expect(durableRateLimitConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(
      durableRateLimitConfigured({ NODE_ENV: "production", LOGIN_RATE_LIMIT_FILE: "/tmp/rl.json" }),
    ).toBe(true);
    expect(
      durableRateLimitConfigured({ NODE_ENV: "production", DATABASE_URL: "postgres://x" }),
    ).toBe(true);
    expect(durableRateLimitConfigured({ NODE_ENV: "test" })).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "aa-rl-"));
    const file = join(dir, "limit.json");
    const now = 1_700_000_000_000;
    try {
      for (let i = 0; i < 10; i++) {
        expect(consumeDurableLoginAttempt("8.8.8.8", now, file)).toEqual({ ok: true });
      }
      expect(consumeDurableLoginAttempt("8.8.8.8", now + 1, file)).toEqual({
        ok: false,
        retryAfterSec: 900,
      });
      expect(consumeDurableLoginAttempt("8.8.8.8", now + 1, file)).toEqual({
        ok: false,
        retryAfterSec: 900,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function signInReq() {
  return new Request("http://localhost/api/auth/sign-in/email", { method: "POST" });
}

describe("consumeLoginThrottle", () => {
  it("uses the file store on the shared login path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aa-rl-"));
    const file = join(dir, "limit.json");
    const prev = process.env.LOGIN_RATE_LIMIT_FILE;
    process.env.LOGIN_RATE_LIMIT_FILE = file;
    const now = 1_700_000_000_000;
    try {
      for (let i = 0; i < 10; i++) {
        expect(await consumeLoginThrottle("1.1.1.1", now)).toEqual({ ok: true });
      }
      expect(await consumeLoginThrottle("1.1.1.1", now + 1)).toEqual({
        ok: false,
        retryAfterSec: 900,
      });
      await resetLoginThrottle("1.1.1.1");
      expect(await consumeLoginThrottle("1.1.1.1", now + 1)).toEqual({ ok: true });
    } finally {
      if (prev === undefined) delete process.env.LOGIN_RATE_LIMIT_FILE;
      else process.env.LOGIN_RATE_LIMIT_FILE = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("withLoginRateLimit", () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-rl-api-"));
  const file = join(dir, "limit.json");
  const prevFile = process.env.LOGIN_RATE_LIMIT_FILE;

  beforeEach(() => {
    process.env.LOGIN_RATE_LIMIT_FILE = file;
    try {
      rmSync(file);
    } catch {
      /* missing */
    }
  });

  afterAll(() => {
    if (prevFile === undefined) delete process.env.LOGIN_RATE_LIMIT_FILE;
    else process.env.LOGIN_RATE_LIMIT_FILE = prevFile;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 429 and Retry-After after the 10th failed sign-in", async () => {
    const next = vi.fn(async () => new Response("no", { status: 401 }));
    for (let i = 0; i < 10; i++) {
      const res = await withLoginRateLimit(signInReq(), next);
      expect(res.status).toBe(401);
    }
    const blocked = await withLoginRateLimit(signInReq(), next);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    await expect(blocked.json()).resolves.toMatchObject({
      message: expect.stringMatching(/Try again in \d+s/),
    });
    expect(next).toHaveBeenCalledTimes(10);
  });

  it("resets the bucket after a successful sign-in so another attempt is allowed", async () => {
    const fail = vi.fn(async () => new Response("no", { status: 401 }));
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    for (let i = 0; i < 9; i++) {
      await withLoginRateLimit(signInReq(), fail);
    }
    expect((await withLoginRateLimit(signInReq(), ok)).status).toBe(200);
    expect((await withLoginRateLimit(signInReq(), fail)).status).toBe(401);
  });

  it("passes through non-sign-in paths such as sign-out", async () => {
    const next = vi.fn(async () => new Response("ok", { status: 200 }));
    const req = new Request("http://localhost/api/auth/sign-out", { method: "POST" });
    const res = await withLoginRateLimit(req, next);
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });
});

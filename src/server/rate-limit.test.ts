import { afterEach, describe, expect, it } from "vitest";
import {
  clearLoginRateLimits,
  clientIpFromHeaders,
  consumeLoginAttempt,
  resetLoginAttempts,
} from "./rate-limit";

afterEach(() => {
  clearLoginRateLimits();
});

describe("clientIpFromHeaders", () => {
  it("uses the first x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": " 203.0.113.9, 10.0.0.1 ",
      "x-real-ip": "10.0.0.2",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
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
});

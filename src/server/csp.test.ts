import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  it("omits unsafe-eval and script unsafe-inline in production", () => {
    const csp = contentSecurityPolicy({ nonce: "abc123", nodeEnv: "production" });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toMatch(/unsafe-eval/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows unsafe-eval in development only", () => {
    const csp = contentSecurityPolicy({ nonce: "devnonce", nodeEnv: "development" });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

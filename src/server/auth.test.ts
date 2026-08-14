import { describe, expect, it } from "vitest";
import {
  emailAndPasswordConfig,
  requireBetterAuthSecret,
  sessionCookieAttributes,
} from "./auth";

describe("BETTER_AUTH_SECRET", () => {
  it("is required at runtime", () => {
    expect(() => requireBetterAuthSecret({})).toThrow(/BETTER_AUTH_SECRET is required/);
    expect(() => requireBetterAuthSecret({ BETTER_AUTH_SECRET: "   " })).toThrow(
      /BETTER_AUTH_SECRET is required/,
    );
    expect(requireBetterAuthSecret({ BETTER_AUTH_SECRET: "test-secret" })).toBe("test-secret");
  });
});

describe("Better Auth options", () => {
  it("disables public email sign-up", () => {
    expect(emailAndPasswordConfig.enabled).toBe(true);
    expect(emailAndPasswordConfig.disableSignUp).toBe(true);
  });

  it("pins httpOnly session cookies and Secure in production", () => {
    expect(sessionCookieAttributes({ NODE_ENV: "development" })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
    expect(sessionCookieAttributes({ NODE_ENV: "production" })).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
  });
});

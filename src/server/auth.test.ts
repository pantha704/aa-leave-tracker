import { describe, expect, it } from "vitest";
import { requireBetterAuthSecret } from "./auth";

describe("BETTER_AUTH_SECRET", () => {
  it("is required at runtime", () => {
    expect(() => requireBetterAuthSecret({})).toThrow(/BETTER_AUTH_SECRET is required/);
    expect(() => requireBetterAuthSecret({ BETTER_AUTH_SECRET: "   " })).toThrow(
      /BETTER_AUTH_SECRET is required/,
    );
    expect(requireBetterAuthSecret({ BETTER_AUTH_SECRET: "test-secret" })).toBe("test-secret");
  });
});

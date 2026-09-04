import { describe, expect, it } from "vitest";
import { privilegedMfaConfigured } from "./mfa";

describe("privilegedMfaConfigured", () => {
  it("blocks production unless PRIVILEGED_MFA=1", () => {
    expect(privilegedMfaConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(privilegedMfaConfigured({ NODE_ENV: "production", PRIVILEGED_MFA: "1" })).toBe(true);
    expect(privilegedMfaConfigured({ NODE_ENV: "development" })).toBe(true);
  });
});

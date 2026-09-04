import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("signInAction", () => {
  it("throttles through consumeLoginThrottle, not the in-process map", () => {
    const src = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    expect(src).toMatch(/consumeLoginThrottle/);
    expect(src).not.toMatch(/consumeLoginAttempt\(/);
  });
});

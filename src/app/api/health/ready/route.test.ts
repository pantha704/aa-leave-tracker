import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

describe("GET /api/health/ready", () => {
  it("is not ready when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, ready: false, db: "missing" });
  });
});

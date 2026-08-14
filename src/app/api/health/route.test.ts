import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalUrl;
  }
});

describe("GET /api/health", () => {
  it("returns ok and skipped when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: "skipped" });
  });

  it("returns ok and skipped when DATABASE_URL is whitespace", async () => {
    process.env.DATABASE_URL = "   ";
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: "skipped" });
  });

  it("returns ok and down when Postgres refuses the connection", async () => {
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:59999/aa_leave_tracker";
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: "down" });
  });

  it("returns ok and down when DATABASE_URL is not a URL", async () => {
    process.env.DATABASE_URL = "not-a-url";
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: "down" });
  });
});

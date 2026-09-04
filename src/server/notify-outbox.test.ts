import { describe, expect, it } from "vitest";
import {
  enqueueOutbox,
  nextOutboxAttempt,
  OUTBOX_MAX_ATTEMPTS,
  outboxIdempotencyKey,
} from "./notify-outbox";

describe("enqueueOutbox", () => {
  it("is idempotent for the same kind and source", () => {
    const first = enqueueOutbox([], {
      id: "1",
      organizationId: "org-a",
      kind: "leave.pending",
      sourceId: "entry-1",
      payload: { to: "mgr@example.com" },
    });
    expect(first.inserted).toBe(true);
    const second = enqueueOutbox(first.records, {
      id: "2",
      organizationId: "org-a",
      kind: "leave.pending",
      sourceId: "entry-1",
      payload: { to: "mgr@example.com" },
    });
    expect(second.inserted).toBe(false);
    expect(second.records).toHaveLength(1);
    expect(outboxIdempotencyKey("leave.pending", "entry-1")).toBe("leave.pending:entry-1");
  });
});

describe("nextOutboxAttempt", () => {
  it("marks sent on success and dead-letters after bounded retries", () => {
    expect(nextOutboxAttempt({ attempts: 0, status: "pending" }, true)).toEqual({
      status: "sent",
      attempts: 1,
    });
    expect(nextOutboxAttempt({ attempts: OUTBOX_MAX_ATTEMPTS - 1, status: "pending" }, false)).toEqual({
      status: "failed",
      attempts: OUTBOX_MAX_ATTEMPTS,
    });
  });
});

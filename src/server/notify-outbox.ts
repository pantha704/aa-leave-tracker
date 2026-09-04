import { and, eq, lte, or, sql } from "drizzle-orm";
import { notificationOutbox } from "@/db/schema-ops";
import { isUniqueViolation } from "@/server/pg-error";
import type { LedgerDb } from "@/server/ledger/balance";

export type OutboxKind = "leave.pending" | "leave.decision";

export type OutboxRecord = {
  id: string;
  organizationId: string;
  kind: OutboxKind;
  sourceId: string;
  payload: Record<string, unknown>;
  status: "pending" | "sent" | "failed";
  attempts: number;
};

export const OUTBOX_MAX_ATTEMPTS = 8;

export function outboxIdempotencyKey(kind: OutboxKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export type EnqueueOutboxInput = {
  organizationId: string;
  kind: OutboxKind;
  sourceId: string;
  payload: Record<string, unknown>;
  id?: string;
};

/** Insert into `notification_outbox` on the same DB/tx the caller holds. Idempotent on kind+source_id. */
export async function enqueueProcessOutbox(
  input: EnqueueOutboxInput,
  db: LedgerDb,
): Promise<boolean> {
  try {
    await db.insert(notificationOutbox).values({
      ...(input.id ? { id: input.id } : {}),
      orgId: input.organizationId,
      kind: input.kind,
      sourceId: input.sourceId,
      payload: JSON.stringify(input.payload),
      status: "pending",
      attempts: 0,
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

export function nextOutboxAttempt(
  row: Pick<OutboxRecord, "attempts" | "status">,
  ok: boolean,
): { status: OutboxRecord["status"]; attempts: number } {
  const attempts = row.attempts + 1;
  if (ok) return { status: "sent", attempts };
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return { status: "failed", attempts };
  return { status: "pending", attempts };
}

export async function processOutboxBatch(
  db: LedgerDb,
  send: (row: { id: string; kind: string; sourceId: string; payload: string }) => Promise<void>,
  limit = 20,
): Promise<{ sent: number; failed: number }> {
  const rows = await db
    .select()
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.status, "pending"),
        or(sql`${notificationOutbox.nextAttemptAt} IS NULL`, lte(notificationOutbox.nextAttemptAt, new Date())),
      ),
    )
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await send({
        id: row.id,
        kind: row.kind,
        sourceId: row.sourceId,
        payload: row.payload,
      });
      const next = nextOutboxAttempt({ attempts: row.attempts, status: "pending" }, true);
      await db
        .update(notificationOutbox)
        .set({ status: next.status, attempts: next.attempts, sentAt: new Date(), lastError: null })
        .where(eq(notificationOutbox.id, row.id));
      sent += 1;
    } catch (err) {
      const next = nextOutboxAttempt({ attempts: row.attempts, status: "pending" }, false);
      await db
        .update(notificationOutbox)
        .set({
          status: next.status,
          attempts: next.attempts,
          lastError: err instanceof Error ? err.message : "send_failed",
          nextAttemptAt: new Date(Date.now() + 2 ** Math.min(next.attempts, 8) * 1000),
        })
        .where(eq(notificationOutbox.id, row.id));
      if (next.status === "failed") failed += 1;
    }
  }
  return { sent, failed };
}

export function enqueueOutbox(
  existing: readonly OutboxRecord[],
  input: {
    organizationId: string;
    kind: OutboxKind;
    sourceId: string;
    payload: Record<string, unknown>;
    id: string;
  },
): { records: OutboxRecord[]; inserted: boolean } {
  const key = outboxIdempotencyKey(input.kind, input.sourceId);
  if (existing.some((row) => outboxIdempotencyKey(row.kind, row.sourceId) === key)) {
    return { records: [...existing], inserted: false };
  }
  return {
    inserted: true,
    records: [
      ...existing,
      {
        id: input.id,
        organizationId: input.organizationId,
        kind: input.kind,
        sourceId: input.sourceId,
        payload: input.payload,
        status: "pending",
        attempts: 0,
      },
    ],
  };
}

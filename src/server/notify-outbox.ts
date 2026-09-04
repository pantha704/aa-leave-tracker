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

export function outboxIdempotencyKey(kind: OutboxKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export const processNotificationOutbox: OutboxRecord[] = [];

export function enqueueProcessOutbox(input: {
  organizationId: string;
  kind: OutboxKind;
  sourceId: string;
  payload: Record<string, unknown>;
  id?: string;
}): boolean {
  const result = enqueueOutbox(processNotificationOutbox, {
    ...input,
    id: input.id ?? `${input.kind}:${input.sourceId}:${processNotificationOutbox.length}`,
  });
  processNotificationOutbox.splice(0, processNotificationOutbox.length, ...result.records);
  return result.inserted;
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

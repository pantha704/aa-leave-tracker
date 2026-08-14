import { auditEvents } from "@/db/schema";
import { getDb } from "./db";

export type AuditEventInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

export type AuditWriter = (input: AuditEventInput) => Promise<void>;

export function auditEventValues(input: AuditEventInput) {
  return {
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    beforeJson: input.before ?? null,
    afterJson: input.after ?? null,
  };
}

export type AuditInsertDb = {
  insert: (table: typeof auditEvents) => {
    values: (row: ReturnType<typeof auditEventValues>) => unknown;
  };
};

export async function writeAuditEvent(
  input: AuditEventInput,
  db: AuditInsertDb = getDb(),
): Promise<void> {
  await db.insert(auditEvents).values(auditEventValues(input));
}

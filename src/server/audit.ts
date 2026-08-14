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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asAuditUuid(value: string | null | undefined): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function auditEventValues(input: AuditEventInput) {
  const entityId = asAuditUuid(input.entityId);
  let afterJson: unknown = input.after ?? null;
  if (input.entityId && !entityId) {
    afterJson = {
      ...(isPlainObject(afterJson) ? afterJson : afterJson != null ? { value: afterJson } : {}),
      entityIdRaw: input.entityId,
    };
  }

  return {
    actorId: asAuditUuid(input.actorId),
    action: input.action,
    entityType: input.entityType,
    entityId,
    beforeJson: input.before ?? null,
    afterJson,
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
  try {
    await db.insert(auditEvents).values(auditEventValues(input));
  } catch (err) {
    console.error("audit_events insert failed", err);
  }
}

/** Never throw: authz result must not become 500 because audit I/O failed. */
export async function tryWriteAudit(writeAudit: AuditWriter, input: AuditEventInput): Promise<void> {
  try {
    await writeAudit(input);
  } catch (err) {
    console.error("audit write failed", err);
  }
}

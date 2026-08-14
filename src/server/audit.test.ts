import { afterEach, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  auditEventValues,
  tryWriteAudit,
  writeAuditEvent,
  type AuditEventInput,
} from "./audit";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";

describe("auditEventValues", () => {
  it("maps actor, action, entity, and before/after json", () => {
    const input: AuditEventInput = {
      actorId: ACTOR,
      action: "employee.balances.read",
      entityType: "employee",
      entityId: ENTITY,
      before: { remaining: 1 },
      after: { remaining: 2 },
    };
    expect(auditEventValues(input)).toEqual({
      actorId: ACTOR,
      action: "employee.balances.read",
      entityType: "employee",
      entityId: ENTITY,
      beforeJson: { remaining: 1 },
      afterJson: { remaining: 2 },
    });
  });

  it("nulls optional json and entity id", () => {
    expect(
      auditEventValues({
        actorId: null,
        action: "idor.denied",
        entityType: "employee",
      }),
    ).toEqual({
      actorId: null,
      action: "idor.denied",
      entityType: "employee",
      entityId: null,
      beforeJson: null,
      afterJson: null,
    });
  });

  it("omits non-uuid ids so a guess cannot break the insert", () => {
    expect(
      auditEventValues({
        actorId: "alice",
        action: "idor.denied",
        entityType: "employee",
        entityId: "not-a-uuid",
        after: { reason: "admin_required" },
      }),
    ).toEqual({
      actorId: null,
      action: "idor.denied",
      entityType: "employee",
      entityId: null,
      beforeJson: null,
      afterJson: { reason: "admin_required", entityIdRaw: "not-a-uuid" },
    });
  });
});

describe("writeAuditEvent", () => {
  afterEach(() => {
    console.error = consoleError;
  });

  const consoleError = console.error;

  it("inserts a row on the audit_events table", async () => {
    const inserted: unknown[] = [];
    const db = {
      insert: (table: Parameters<typeof getTableConfig>[0]) => {
        expect(getTableConfig(table).name).toBe("audit_events");
        return {
          values: (row: unknown) => {
            inserted.push(row);
            return Promise.resolve();
          },
        };
      },
    };

    await writeAuditEvent(
      {
        actorId: ACTOR,
        action: "employee.balances.read",
        entityType: "employee",
        entityId: ENTITY,
        after: { lineCount: 0 },
      },
      db,
    );

    expect(inserted).toEqual([
      {
        actorId: ACTOR,
        action: "employee.balances.read",
        entityType: "employee",
        entityId: ENTITY,
        beforeJson: null,
        afterJson: { lineCount: 0 },
      },
    ]);
  });

  it("tryWriteAudit swallows a throwing writer", async () => {
    console.error = () => {};
    await expect(
      tryWriteAudit(async () => {
        throw new Error("audit down");
      }, {
        actorId: ACTOR,
        action: "idor.denied",
        entityType: "employee",
        entityId: "not-a-uuid",
      }),
    ).resolves.toBeUndefined();
  });

  it("swallows insert failures so callers still return their authz status", async () => {
    console.error = () => {};
    const db = {
      insert: () => ({
        values: () => {
          throw new Error("invalid input syntax for type uuid");
        },
      }),
    };

    await expect(
      writeAuditEvent({
        actorId: ACTOR,
        action: "idor.denied",
        entityType: "employee",
        entityId: "not-a-uuid",
      }, db),
    ).resolves.toBeUndefined();
  });
});

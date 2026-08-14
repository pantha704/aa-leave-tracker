import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { auditEventValues, writeAuditEvent, type AuditEventInput } from "./audit";

describe("auditEventValues", () => {
  it("maps actor, action, entity, and before/after json", () => {
    const input: AuditEventInput = {
      actorId: "actor-1",
      action: "employee.balances.read",
      entityType: "employee",
      entityId: "emp-2",
      before: { remaining: 1 },
      after: { remaining: 2 },
    };
    expect(auditEventValues(input)).toEqual({
      actorId: "actor-1",
      action: "employee.balances.read",
      entityType: "employee",
      entityId: "emp-2",
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
});

describe("writeAuditEvent", () => {
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
        actorId: "a",
        action: "employee.balances.read",
        entityType: "employee",
        entityId: "b",
        after: { lineCount: 0 },
      },
      db,
    );

    expect(inserted).toEqual([
      {
        actorId: "a",
        action: "employee.balances.read",
        entityType: "employee",
        entityId: "b",
        beforeJson: null,
        afterJson: { lineCount: 0 },
      },
    ]);
  });
});

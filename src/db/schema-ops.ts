import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { employees, organizations } from "./schema";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    payload: text("payload").notNull().default("{}"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamptz("next_attempt_at"),
    sentAt: timestamptz("sent_at"),
    lastError: text("last_error"),
  },
  (t) => [unique("notification_outbox_kind_source").on(t.kind, t.sourceId)],
);

export const makeupEntries = pgTable("makeup_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  missedDate: text("missed_date").notNull(),
  makeupDate: text("makeup_date").notNull(),
  minutes: integer("minutes").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  managerId: uuid("manager_id").references(() => employees.id),
  decidedBy: uuid("decided_by").references(() => employees.id),
  decidedAt: timestamptz("decided_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const loginRateLimits = pgTable("login_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamptz("reset_at").notNull(),
});

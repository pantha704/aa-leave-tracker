import { and, eq, gte, lte } from "drizzle-orm";
import {
  employees,
  leaveDays,
  leaveEntries,
  leaveTypes,
  organizations,
  orgSettings,
} from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "./audit";
import { canAdmin, type AuthzActor } from "./authz";
import { getDb } from "./db";
import { addIsoDays, asOfDateString } from "./ledger/balance";
import { isoWeekday } from "./policy/days";

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MAX_RANGE_DAYS = 93;

export type CalendarPersonRaw = {
  employeeId: string;
  name: string;
  onDate: string;
  portion: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  note?: string | null;
  adminNote?: string | null;
};

export type CalendarPerson = {
  employeeId: string;
  name: string;
  onDate: string;
  portion: string;
  leaveTypeName?: string;
};

export type CalendarOrgContext = {
  timezone: string;
  showType: boolean;
  enabled: boolean;
};

export type CalendarStore = {
  loadOrgContext: (orgId: string) => Promise<CalendarOrgContext | null>;
  loadOutDays: (orgId: string, from: string, to: string) => Promise<CalendarPersonRaw[]>;
};

export type CalendarOffBody = {
  enabled: false;
  showType: false;
  people: [];
};

export type CalendarOnBody = {
  enabled: true;
  showType: boolean;
  from: string;
  to: string;
  people: CalendarPerson[];
};

export type CalendarReadResult =
  | { status: 401; body: { error: string } }
  | { status: 400; body: { error: string } }
  | { status: 200; body: CalendarOffBody }
  | { status: 200; body: CalendarOnBody };

export function isTeamCalendarOn(
  result: CalendarReadResult | null,
): result is { status: 200; body: CalendarOnBody } {
  return result?.status === 200 && result.body.enabled === true;
}

const PRIVATE_KEYS = new Set(["note", "adminNote", "admin_note", "leaveTypeCode", "leaveTypeId"]);

export function calendarPayloadHasPrivateFields(
  value: unknown,
  options: { showType?: boolean } = {},
): boolean {
  const blocked = new Set(PRIVATE_KEYS);
  if (!options.showType) blocked.add("leaveTypeName");
  return hasBlockedKeys(value, blocked);
}

function hasBlockedKeys(value: unknown, blocked: Set<string>): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => hasBlockedKeys(child, blocked));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
      if (blocked.has(key)) return true;
      return hasBlockedKeys(child, blocked);
    });
  }
  return false;
}

export function redactCalendarPerson(raw: CalendarPersonRaw, showType: boolean): CalendarPerson {
  const person: CalendarPerson = {
    employeeId: raw.employeeId,
    name: raw.name,
    onDate: raw.onDate,
    portion: raw.portion,
  };
  if (showType) {
    person.leaveTypeName = raw.leaveTypeName;
  }
  return person;
}

export function monthStart(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function monthEnd(year: number, month: number): string {
  const start = monthStart(year, month);
  const nextMonth = month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1);
  return addIsoDays(nextMonth, -1);
}

export function shiftYearMonth(
  year: number,
  month: number,
  deltaMonths: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + deltaMonths;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function parseCalendarMonth(
  yearRaw: string | undefined,
  monthRaw: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): { year: number; month: number } | { error: string } {
  const today = asOfDateString(now, timeZone);
  const fallbackYear = Number(today.slice(0, 4));
  const fallbackMonth = Number(today.slice(5, 7));
  if (yearRaw == null && monthRaw == null) {
    return { year: fallbackYear, month: fallbackMonth };
  }
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: "year must be an integer between 2000 and 2100" };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "month must be an integer from 1 to 12" };
  }
  return { year, month };
}

function requireCivilIsoDate(value: string): string | null {
  if (!ISO_DATE.test(value)) return null;
  const normalized = addIsoDays(value, 0);
  return normalized === value ? value : null;
}

export function parseCalendarRange(
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { from: string; to: string } | { error: string } {
  if (!fromRaw || !toRaw) {
    return { error: "from and to are required (YYYY-MM-DD)" };
  }
  const from = requireCivilIsoDate(fromRaw);
  const to = requireCivilIsoDate(toRaw);
  if (!from || !to) {
    return { error: "from and to must be YYYY-MM-DD" };
  }
  if (to < from) {
    return { error: "to must be on or after from" };
  }
  let days = 1;
  for (let cursor = from; cursor < to; cursor = addIsoDays(cursor, 1)) {
    days += 1;
    if (days > MAX_RANGE_DAYS) {
      return { error: `range cannot exceed ${MAX_RANGE_DAYS} days` };
    }
  }
  return { from, to };
}

export type MonthCell = {
  date: string;
  inMonth: boolean;
  weekday: number;
};

/** Monday-first month grid (ISO week). */
export function monthCells(year: number, month: number): MonthCell[] {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const lead = isoWeekday(start) - 1;
  const first = addIsoDays(start, -lead);
  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const date = addIsoDays(first, i);
    cells.push({
      date,
      inMonth: date >= start && date <= end,
      weekday: isoWeekday(date),
    });
  }
  return cells;
}

/** Columns the calendar query may return. Notes are never selected. */
export const TEAM_CALENDAR_OUT_SELECT = {
  employeeId: employees.id,
  name: employees.name,
  onDate: leaveDays.onDate,
  portion: leaveDays.portion,
  leaveTypeName: leaveTypes.name,
  leaveTypeCode: leaveTypes.code,
} as const;

export const defaultCalendarStore: CalendarStore = {
  async loadOrgContext(orgId) {
    const [row] = await getDb()
      .select({
        timezone: organizations.timezone,
        showType: organizations.teamCalendarShowType,
        enabled: orgSettings.teamCalendarEnabled,
      })
      .from(organizations)
      .leftJoin(orgSettings, eq(orgSettings.orgId, organizations.id))
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!row) return null;
    return {
      timezone: row.timezone,
      showType: row.showType,
      enabled: row.enabled ?? false,
    };
  },
  async loadOutDays(orgId, from, to) {
    return getDb()
      .select(TEAM_CALENDAR_OUT_SELECT)
      .from(leaveDays)
      .innerJoin(leaveEntries, eq(leaveDays.leaveEntryId, leaveEntries.id))
      .innerJoin(employees, eq(leaveDays.employeeId, employees.id))
      .innerJoin(leaveTypes, eq(leaveEntries.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(employees.orgId, orgId),
          eq(employees.active, true),
          eq(leaveEntries.status, "approved"),
          eq(leaveDays.slotActive, true),
          eq(leaveTypes.visibleOnTeamCalendar, true),
          gte(leaveDays.onDate, from),
          lte(leaveDays.onDate, to),
        ),
      );
  },
};

export async function readTeamCalendar(input: {
  actor: AuthzActor | null;
  orgId: string;
  from: string;
  to: string;
  store?: CalendarStore;
}): Promise<CalendarReadResult> {
  const { actor, orgId, from, to } = input;
  const store = input.store ?? defaultCalendarStore;

  if (!actor) {
    return { status: 401, body: { error: "unauthenticated" } };
  }

  const range = parseCalendarRange(from, to);
  if ("error" in range) {
    return { status: 400, body: { error: range.error } };
  }

  const ctx = await store.loadOrgContext(orgId);
  if (!ctx?.enabled) {
    return { status: 200, body: { enabled: false, showType: false, people: [] } };
  }

  const raw = await store.loadOutDays(orgId, range.from, range.to);
  const people = raw.map((row) => redactCalendarPerson(row, ctx.showType));
  return {
    status: 200,
    body: {
      enabled: true,
      showType: ctx.showType,
      from: range.from,
      to: range.to,
      people,
    },
  };
}

export type CalendarFlagWriter = {
  upsertEnabled: (orgId: string, enabled: boolean) => Promise<boolean>;
  updateShowType: (orgId: string, showType: boolean) => Promise<boolean>;
};

export const defaultCalendarFlagWriter: CalendarFlagWriter = {
  async upsertEnabled(orgId, enabled) {
    try {
      const [row] = await getDb()
        .insert(orgSettings)
        .values({ orgId, teamCalendarEnabled: enabled })
        .onConflictDoUpdate({
          target: orgSettings.orgId,
          set: { teamCalendarEnabled: enabled },
        })
        .returning({ orgId: orgSettings.orgId });
      return row != null;
    } catch {
      return false;
    }
  },
  async updateShowType(orgId, showType) {
    const [row] = await getDb()
      .update(organizations)
      .set({ teamCalendarShowType: showType })
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id });
    return row != null;
  },
};

export async function updateTeamCalendarFlags(input: {
  actor: AuthzActor | null;
  orgId: string;
  enabled?: boolean;
  showType?: boolean;
  writeAudit?: AuditWriter;
  flags?: CalendarFlagWriter;
}): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404; error: string }> {
  const { actor, orgId } = input;
  const flags = input.flags ?? defaultCalendarFlagWriter;
  if (!actor) {
    return { ok: false, status: 401, error: "unauthenticated" };
  }
  if (!canAdmin(actor)) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  if (input.enabled != null) {
    const wrote = await flags.upsertEnabled(orgId, input.enabled);
    if (!wrote) {
      return { ok: false, status: 404, error: "could not update team calendar" };
    }
  }
  if (input.showType != null) {
    const wrote = await flags.updateShowType(orgId, input.showType);
    if (!wrote) {
      return { ok: false, status: 404, error: "could not update team calendar" };
    }
  }

  await tryWriteAudit(input.writeAudit ?? writeAuditEvent, {
    actorId: actor.id,
    action: "org.team_calendar.update",
    entityType: "organization",
    entityId: orgId,
    after: { enabled: input.enabled ?? null, showType: input.showType ?? null },
  });
  return { ok: true };
}

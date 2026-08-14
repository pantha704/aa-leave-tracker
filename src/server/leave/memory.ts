import { computeBalance } from "@/server/ledger/balance";
import { MemoryLedger, SerialLock } from "@/server/ledger/memory";
import { portionsConflict } from "@/server/policy/rules/overlap";
import type { ExistingLeave, HolidayDate, PeriodStatus, PolicySnapshot } from "@/server/policy/types";
import type {
  LeaveDayRecord,
  LeaveEntryRecord,
  LeaveStore,
  LoadSnapshotResult,
  OrgLeaveSettings,
  SubmitSnapshot,
} from "./submit";

export type MemoryWorld = {
  employee: SubmitSnapshot["employee"];
  leaveType: SubmitSnapshot["leaveType"];
  policy: PolicySnapshot;
  holidays?: HolidayDate[];
  periodStatuses?: PeriodStatus[];
  today: string;
  orgSettings?: Partial<OrgLeaveSettings>;
  hasPolicy?: boolean;
};

const DEFAULT_ORG_SETTINGS: OrgLeaveSettings = {
  appReadonly: false,
  selfLogEnabled: true,
  requestsEnabled: true,
};

export class MemoryLeaveStore implements LeaveStore {
  readonly ledger = new MemoryLedger();
  readonly lock = new SerialLock();
  readonly entries: LeaveEntryRecord[] = [];
  readonly days: LeaveDayRecord[] = [];
  holidays: HolidayDate[] = [];
  periodStatuses: PeriodStatus[] = [];
  today: string;
  employee: SubmitSnapshot["employee"];
  leaveType: SubmitSnapshot["leaveType"];
  policy: PolicySnapshot;
  orgSettings: OrgLeaveSettings;
  hasPolicy: boolean;

  constructor(world: MemoryWorld) {
    this.employee = world.employee;
    this.leaveType = world.leaveType;
    this.policy = world.policy;
    this.holidays = [...(world.holidays ?? [])];
    this.periodStatuses = [...(world.periodStatuses ?? [])];
    this.today = world.today;
    this.orgSettings = { ...DEFAULT_ORG_SETTINGS, ...world.orgSettings };
    this.hasPolicy = world.hasPolicy !== false;
  }

  async withEmployeeLock<T>(employeeId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(employeeId, fn);
  }

  async loadSubmitSnapshot(input: {
    employeeId: string;
    leaveTypeId: string;
    today?: string;
  }): Promise<LoadSnapshotResult> {
    if (input.employeeId !== this.employee.id) return { ok: false, reason: "not_found" };
    if (input.leaveTypeId !== this.leaveType.id) return { ok: false, reason: "not_found" };
    if (!this.hasPolicy) return { ok: false, reason: "no_policy" };
    const today = input.today ?? this.today;
    const existing = this.existingLeaves();
    this.syncPending();
    const balance = computeBalance({
      rows: this.ledger.rows,
      pendingEntries: this.ledger.pending,
      asOf: today,
      timeZone: this.employee.timezone,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
    });
    return {
      ok: true,
      snapshot: {
        employee: this.employee,
        leaveType: this.leaveType,
        policy: this.policy,
        holidays: this.holidays,
        existing,
        periodStatuses: this.periodStatuses,
        today,
        balance,
        orgSettings: this.orgSettings,
      },
    };
  }

  async getBalanceAsOf(input: {
    employeeId: string;
    leaveTypeId: string;
    asOf: string;
    timeZone?: string;
  }) {
    this.syncPending();
    return computeBalance({
      rows: this.ledger.rows,
      pendingEntries: this.ledger.pending,
      asOf: input.asOf,
      timeZone: input.timeZone ?? this.employee.timezone,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
    });
  }

  syncPending() {
    this.ledger.pending = this.entries
      .filter((entry) => entry.status === "pending")
      .map((entry) => ({
        status: entry.status,
        totalMinutes: entry.totalMinutes,
        startDate: entry.startDate,
        endDate: entry.endDate,
        employeeId: entry.employeeId,
        leaveTypeId: entry.leaveTypeId,
        days: this.days
          .filter((day) => day.leaveEntryId === entry.id)
          .map((day) => ({ onDate: day.onDate, minutes: day.minutes })),
      }));
  }

  existingLeaves(): ExistingLeave[] {
    return this.entries.map((entry) => {
      const days = this.days.filter((day) => day.leaveEntryId === entry.id);
      return {
        id: entry.id,
        startDate: entry.startDate,
        endDate: entry.endDate,
        portion: entry.portion,
        customMinutes: entry.customMinutes,
        consumesBalance: days[0]?.consumesBalance ?? this.leaveType.consumesBalance,
        status: entry.status,
        slotActive: days.some((day) => day.slotActive),
        days: days.map((day) => ({
          onDate: day.onDate,
          portion: day.portion,
          consumesBalance: day.consumesBalance,
          slotActive: day.slotActive,
        })),
      };
    });
  }

  async insertEntry(entry: LeaveEntryRecord, days: LeaveDayRecord[]): Promise<void> {
    for (const day of days) {
      if (!day.consumesBalance || !day.slotActive) continue;
      const clash = this.days.find(
        (other) =>
          other.employeeId === day.employeeId &&
          other.onDate === day.onDate &&
          other.consumesBalance &&
          other.slotActive &&
          portionsConflict(other.portion, day.portion),
      );
      if (clash) {
        throw new Error("overlap: consuming slot already active");
      }
    }
    this.entries.push({ ...entry });
    this.days.push(...days.map((day) => ({ ...day })));
  }

  async getEntry(id: string): Promise<{ entry: LeaveEntryRecord; days: LeaveDayRecord[] } | null> {
    const entry = this.entries.find((row) => row.id === id);
    if (!entry) return null;
    return {
      entry: { ...entry, managerId: entry.managerId ?? this.employee.managerId },
      days: this.days.filter((day) => day.leaveEntryId === id).map((day) => ({ ...day })),
    };
  }

  async updateEntry(
    id: string,
    patch: {
      status: LeaveEntryRecord["status"];
      updatedBy: string;
      updatedAt: Date;
      adminNote?: string | null;
    },
  ): Promise<void> {
    const entry = this.entries.find((row) => row.id === id);
    if (!entry) throw new Error(`leave entry not found: ${id}`);
    entry.status = patch.status;
    entry.updatedBy = patch.updatedBy;
    entry.updatedAt = patch.updatedAt;
    if (patch.adminNote !== undefined) entry.adminNote = patch.adminNote;
  }

  async deactivateDays(leaveEntryId: string): Promise<void> {
    for (const day of this.days) {
      if (day.leaveEntryId === leaveEntryId) day.slotActive = false;
    }
  }

  async postUsage(input: {
    employeeId: string;
    leaveTypeId: string;
    day: LeaveDayRecord;
    createdBy: string;
    createdAt: Date;
  }): Promise<void> {
    this.ledger.post({
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      kind: "usage",
      minutes: input.day.minutes,
      effectiveOn: input.day.onDate,
      leaveEntryId: input.day.leaveEntryId,
      leaveDayId: input.day.id,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
  }

  async reverseUsageForEntry(input: {
    leaveEntryId: string;
    createdBy: string;
    reason: string;
    createdAt: Date;
  }): Promise<void> {
    const live = this.ledger.rows.filter(
      (row) => row.leaveEntryId === input.leaveEntryId && row.kind === "usage" && row.reversedAt == null,
    );
    for (const row of live) {
      this.ledger.reverse(row.id, input.createdBy, input.reason);
    }
    void input.createdAt;
  }
}

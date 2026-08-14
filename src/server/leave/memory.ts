import { MemoryLedger } from "@/server/ledger/memory";
import { computeBalance } from "@/server/ledger/balance";
import type { ExistingLeave, HolidayDate, PeriodStatus, PolicySnapshot } from "@/server/policy/types";
import type {
  LeaveDayRecord,
  LeaveEntryRecord,
  LeaveStore,
  SubmitSnapshot,
} from "./submit";

export type MemoryWorld = {
  employee: SubmitSnapshot["employee"];
  leaveType: SubmitSnapshot["leaveType"];
  policy: PolicySnapshot;
  holidays?: HolidayDate[];
  periodStatuses?: PeriodStatus[];
  today: string;
};

export class MemoryLeaveStore implements LeaveStore {
  readonly ledger = new MemoryLedger();
  readonly entries: LeaveEntryRecord[] = [];
  readonly days: LeaveDayRecord[] = [];
  holidays: HolidayDate[] = [];
  periodStatuses: PeriodStatus[] = [];
  today: string;
  employee: SubmitSnapshot["employee"];
  leaveType: SubmitSnapshot["leaveType"];
  policy: PolicySnapshot;

  constructor(world: MemoryWorld) {
    this.employee = world.employee;
    this.leaveType = world.leaveType;
    this.policy = world.policy;
    this.holidays = [...(world.holidays ?? [])];
    this.periodStatuses = [...(world.periodStatuses ?? [])];
    this.today = world.today;
  }

  async withEmployeeLock<T>(_employeeId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async loadSubmitSnapshot(input: {
    employeeId: string;
    leaveTypeId: string;
    today?: string;
  }): Promise<SubmitSnapshot | null> {
    if (input.employeeId !== this.employee.id) return null;
    if (input.leaveTypeId !== this.leaveType.id) return null;
    const today = input.today ?? this.today;
    const existing = this.existingLeaves();
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
    const balance = computeBalance({
      rows: this.ledger.rows,
      pendingEntries: this.ledger.pending,
      asOf: today,
      timeZone: this.employee.timezone,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
    });
    return {
      employee: this.employee,
      leaveType: this.leaveType,
      policy: this.policy,
      holidays: this.holidays,
      existing,
      periodStatuses: this.periodStatuses,
      today,
      balance,
    };
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
          other.portion === day.portion &&
          other.consumesBalance &&
          other.slotActive,
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

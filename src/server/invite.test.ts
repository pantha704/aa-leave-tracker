import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "./audit";
import type { EmployeeRole } from "./auth-gate";
import {
  acceptInvite,
  createEmployeeWithInvite,
  DuplicateEmailError,
  hashInviteToken,
  inviteExpiresAt,
  INVITE_TTL_MS,
  previewInvite,
  type EmployeeRecord,
  type InviteDeps,
  type InviteRecord,
  type InviteStore,
  type RosterActor,
} from "./invite";

const admin: RosterActor = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "admin",
  orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const employee: RosterActor = {
  id: "22222222-2222-4222-8222-222222222222",
  role: "employee",
  orgId: admin.orgId,
};

function memoryInvite(now = new Date("2026-03-15T12:00:00.000Z"), rawToken = "raw-invite-token") {
  const employees = new Map<string, EmployeeRecord>();
  const invites = new Map<string, InviteRecord>();
  const credentials: { authUserId: string; email: string; password: string }[] = [];
  const events: AuditEventInput[] = [];

  const store: InviteStore = {
    async insertEmployee(row) {
      for (const existing of employees.values()) {
        if (existing.orgId === row.orgId && existing.email === row.email) {
          throw new DuplicateEmailError();
        }
      }
      const rec: EmployeeRecord = {
        id: crypto.randomUUID(),
        orgId: row.orgId,
        email: row.email,
        name: row.name,
        role: row.role,
        startDate: row.startDate,
        mustChangePassword: row.mustChangePassword,
        authUserId: null,
      };
      employees.set(rec.id, rec);
      return rec;
    },
    async insertInvite(row) {
      const rec: InviteRecord = {
        id: crypto.randomUUID(),
        employeeId: row.employeeId,
        tokenHash: row.tokenHash,
        expiresAt: row.expiresAt,
        acceptedAt: null,
        createdBy: row.createdBy,
      };
      invites.set(rec.id, rec);
      return rec;
    },
    async findOpenInviteByTokenHash(tokenHash) {
      const invite = [...invites.values()].find((row) => row.tokenHash === tokenHash && row.acceptedAt == null);
      if (!invite) return null;
      const emp = employees.get(invite.employeeId);
      if (!emp) return null;
      return { invite, employee: emp };
    },
    async acceptInvite(input) {
      const invite = invites.get(input.inviteId);
      if (!invite || invite.acceptedAt) return null;
      const emp = employees.get(input.employeeId);
      if (!emp) return null;
      const authUserId = crypto.randomUUID();
      invite.acceptedAt = input.acceptedAt;
      emp.authUserId = authUserId;
      emp.mustChangePassword = false;
      credentials.push({ authUserId, email: input.email, password: input.password });
      return { authUserId };
    },
  };

  const clock = { current: now };
  const deps: InviteDeps = {
    now: () => clock.current,
    randomToken: () => rawToken,
    writeAudit: async (event) => {
      events.push(event);
    },
    store,
  };

  return { employees, invites, credentials, events, deps, clock };
}

describe("hashInviteToken", () => {
  it("is sha256 hex of the raw token", () => {
    expect(hashInviteToken("raw-invite-token")).toBe(
      createHash("sha256").update("raw-invite-token", "utf8").digest("hex"),
    );
    expect(hashInviteToken("raw-invite-token")).toHaveLength(64);
    expect(hashInviteToken("raw-invite-token")).not.toBe("raw-invite-token");
  });

  it("expires seven days after issue", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inviteExpiresAt(from).toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("createEmployeeWithInvite", () => {
  it("employee cannot create employees", async () => {
    const mem = memoryInvite();
    const result = await createEmployeeWithInvite(
      {
        actor: employee,
        name: "New Hire",
        email: "hire@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "forbidden" });
    expect(mem.employees.size).toBe(0);
    expect(mem.invites.size).toBe(0);
    expect(mem.events).toEqual([
      {
        actorId: employee.id,
        action: "idor.denied",
        entityType: "employee",
        after: { reason: "admin_required" },
      },
    ]);
  });

  it("admin creates employee and stores only the hashed token", async () => {
    const rawToken = "shown-once-token";
    const mem = memoryInvite(new Date("2026-03-15T12:00:00.000Z"), rawToken);
    const result = await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "Sam@Example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawToken).toBe(rawToken);
    expect(result.invitePath).toBe(`/invite/${rawToken}`);

    const created = [...mem.employees.values()][0];
    const invite = [...mem.invites.values()][0];
    expect(created.email).toBe("sam@example.com");
    expect(created.role).toBe("employee" satisfies EmployeeRole);
    expect(invite.tokenHash).toBe(hashInviteToken(rawToken));
    expect(invite.tokenHash).not.toContain(rawToken);
    expect(invite.createdBy).toBe(admin.id);
    expect(invite.expiresAt.toISOString()).toBe("2026-03-22T12:00:00.000Z");
    expect(JSON.stringify(mem.events)).not.toContain(rawToken);
  });
});

describe("acceptInvite", () => {
  it("happy path: hashed lookup, credential, mustChangePassword false", async () => {
    const rawToken = "accept-me";
    const mem = memoryInvite(new Date("2026-03-15T12:00:00.000Z"), rawToken);
    const created = await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );
    expect(created.ok).toBe(true);

    const result = await acceptInvite({ rawToken, password: "correct-horse" }, mem.deps);
    expect(result).toMatchObject({ ok: true, email: "sam@example.com" });

    const emp = [...mem.employees.values()][0];
    const invite = [...mem.invites.values()][0];
    expect(emp.authUserId).toBeTruthy();
    expect(emp.mustChangePassword).toBe(false);
    expect(invite.acceptedAt?.toISOString()).toBe("2026-03-15T12:00:00.000Z");
    expect(mem.credentials).toEqual([
      { authUserId: emp.authUserId, email: "sam@example.com", password: "correct-horse" },
    ]);
    expect(mem.events.some((e) => e.action === "invite.accepted")).toBe(true);
  });

  it("rejects an expired token", async () => {
    const rawToken = "stale-token";
    const mem = memoryInvite(new Date("2026-01-01T00:00:00.000Z"), rawToken);
    const created = await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );
    expect(created.ok).toBe(true);

    mem.clock.current = new Date("2026-01-08T00:00:00.000Z");
    const result = await acceptInvite({ rawToken, password: "correct-horse" }, mem.deps);
    expect(result).toEqual({
      ok: false,
      status: 410,
      error: "This invite is invalid or has expired.",
    });
    expect(mem.credentials).toEqual([]);
    expect([...mem.employees.values()][0].authUserId).toBeNull();
    expect([...mem.invites.values()][0].acceptedAt).toBeNull();
    expect(await previewInvite(rawToken, mem.deps)).toMatchObject({ ok: false, status: 410 });
  });

  it("rejects a wrong token without creating a login", async () => {
    const mem = memoryInvite();
    await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );
    const result = await acceptInvite({ rawToken: "not-the-token", password: "correct-horse" }, mem.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(mem.credentials).toEqual([]);
  });
});

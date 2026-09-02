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
  issueInvite,
  previewInvite,
  type EmployeeRecord,
  type InviteDeps,
  type InviteRecord,
  type InviteStore,
  type RosterActor,
} from "./invite";
import { gateInvitePath, inviteTokenFromPath } from "./invite-http";
import {
  attachInviteMembership,
  type MembershipWriter,
} from "./membership";

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
  const credentials: { authUserId: string; email: string; passwordHash: string }[] = [];
  const events: AuditEventInput[] = [];
  const hooks = { failInvite: false };
  const roles = new Map<string, string>();
  const memberships: {
    id: string;
    orgId: string;
    employeeId: string;
    authUserId: string | null;
    roleKey: string;
  }[] = [];

  const writer: MembershipWriter = {
    async findRoleId(orgId, key) {
      const mapKey = `${orgId}:${key}`;
      const existing = roles.get(mapKey);
      if (existing) return existing;
      const id = crypto.randomUUID();
      roles.set(mapKey, id);
      return id;
    },
    async insertMembership(row) {
      const created = { id: crypto.randomUUID(), ...row };
      memberships.push({ ...created, roleKey: "" });
      return { id: created.id };
    },
    async insertMembershipRole(row) {
      const membership = memberships.find((item) => item.id === row.membershipId);
      const roleEntry = [...roles.entries()].find(([, id]) => id === row.roleId);
      if (membership && roleEntry) membership.roleKey = roleEntry[0].split(":")[1] ?? "";
    },
    async setMembershipAuthUser(employeeId, authUserId) {
      for (const membership of memberships) {
        if (membership.employeeId === employeeId) membership.authUserId = authUserId;
      }
    },
  };

  const store: InviteStore = {
    async insertEmployeeWithInvite(input) {
      for (const existing of employees.values()) {
        if (existing.orgId === input.employee.orgId && existing.email === input.employee.email) {
          throw new DuplicateEmailError();
        }
      }
      const rec: EmployeeRecord = {
        id: crypto.randomUUID(),
        orgId: input.employee.orgId,
        email: input.employee.email,
        name: input.employee.name,
        role: input.employee.role,
        startDate: input.employee.startDate,
        mustChangePassword: input.employee.mustChangePassword,
        authUserId: null,
      };
      employees.set(rec.id, rec);
      if (hooks.failInvite) {
        employees.delete(rec.id);
        throw new Error("invite write failed");
      }
      await attachInviteMembership(writer, {
        orgId: input.employee.orgId,
        employeeId: rec.id,
        role: input.employee.role,
        authUserId: null,
      });
      const invite: InviteRecord = {
        id: crypto.randomUUID(),
        employeeId: rec.id,
        tokenHash: input.invite.tokenHash,
        expiresAt: input.invite.expiresAt,
        acceptedAt: null,
        createdBy: input.invite.createdBy,
      };
      invites.set(invite.id, invite);
      return { employee: rec, invite };
    },
    async findEmployeeById(id) {
      return employees.get(id) ?? null;
    },
    async replaceOpenInvite(input) {
      for (const row of invites.values()) {
        if (row.employeeId === input.employeeId && row.acceptedAt == null) {
          row.expiresAt = input.invalidateAt;
        }
      }
      const invite: InviteRecord = {
        id: crypto.randomUUID(),
        employeeId: input.employeeId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        acceptedAt: null,
        createdBy: input.createdBy,
      };
      invites.set(invite.id, invite);
      return invite;
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
      await writer.setMembershipAuthUser(input.employeeId, authUserId);
      credentials.push({ authUserId, email: input.email, passwordHash: input.passwordHash });
      return { authUserId };
    },
  };

  const clock = { current: now };
  const tokens = [rawToken];
  const deps: InviteDeps = {
    now: () => clock.current,
    randomToken: () => tokens.shift() ?? rawToken,
    writeAudit: async (event) => {
      events.push(event);
    },
    hashPassword: async (password) => password,
    store,
  };

  return { employees, invites, credentials, events, deps, clock, hooks, tokens, memberships };
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

  it("rolls back the employee when invite insert fails", async () => {
    const mem = memoryInvite();
    mem.hooks.failInvite = true;
    await expect(
      createEmployeeWithInvite(
        {
          actor: admin,
          name: "Sam Hire",
          email: "sam@example.com",
          startDate: "2026-04-01",
        },
        mem.deps,
      ),
    ).rejects.toThrow(/invite write failed/);
    expect(mem.employees.size).toBe(0);
    expect(mem.invites.size).toBe(0);
  });
});

describe("issueInvite", () => {
  it("mints a new hashed token and expires the previous open invite", async () => {
    const mem = memoryInvite(new Date("2026-03-15T12:00:00.000Z"), "first-token");
    mem.tokens.push("second-token");
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
    if (!created.ok) return;

    const reissued = await issueInvite({ actor: admin, employeeId: created.employeeId }, mem.deps);
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;
    expect(reissued.rawToken).toBe("second-token");
    expect(reissued.invitePath).toBe("/invite/second-token");

    expect(await previewInvite("first-token", mem.deps)).toMatchObject({ ok: false, status: 410 });
    expect(await previewInvite("second-token", mem.deps)).toEqual({ ok: true, name: "Sam Hire" });
    expect(JSON.stringify(mem.events)).not.toContain("second-token");
  });

  it("blocks re-issue after the employee already has a login", async () => {
    const mem = memoryInvite();
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
    if (!created.ok) return;
    await acceptInvite({ rawToken: "raw-invite-token", password: "correct-horse" }, mem.deps);

    const reissued = await issueInvite({ actor: admin, employeeId: created.employeeId }, mem.deps);
    expect(reissued).toEqual({ ok: false, status: 400, error: "Invite already accepted" });
  });

  it("employee cannot re-issue invites", async () => {
    const mem = memoryInvite();
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
    if (!created.ok) return;

    const result = await issueInvite({ actor: employee, employeeId: created.employeeId }, mem.deps);
    expect(result).toEqual({ ok: false, status: 403, error: "forbidden" });
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
      { authUserId: emp.authUserId, email: "sam@example.com", passwordHash: "correct-horse" },
    ]);
    expect(mem.events.some((e) => e.action === "invite.accepted")).toBe(true);
    expect(mem.memberships).toEqual([
      expect.objectContaining({
        employeeId: emp.id,
        orgId: admin.orgId,
        roleKey: "employee",
        authUserId: emp.authUserId,
      }),
    ]);
  });

  it("writes membership and org role on invite insert", async () => {
    const mem = memoryInvite();
    const created = await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
        role: "manager",
      },
      mem.deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(mem.memberships).toEqual([
      expect.objectContaining({
        employeeId: created.employeeId,
        orgId: admin.orgId,
        roleKey: "manager",
        authUserId: null,
      }),
    ]);
  });

  it("hashes the password before the accept write", async () => {
    const order: string[] = [];
    const mem = memoryInvite(new Date("2026-03-15T12:00:00.000Z"), "accept-me");
    await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );
    const origAccept = mem.deps.store.acceptInvite.bind(mem.deps.store);
    mem.deps.hashPassword = async (password) => {
      order.push("hash");
      return `prehashed:${password}`;
    };
    mem.deps.store.acceptInvite = async (input) => {
      order.push("store");
      expect(input.passwordHash).toBe("prehashed:correct-horse");
      return origAccept(input);
    };

    const result = await acceptInvite({ rawToken: "accept-me", password: "correct-horse" }, mem.deps);
    expect(result.ok).toBe(true);
    expect(order).toEqual(["hash", "store"]);
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

describe("gateInvitePath", () => {
  it("extracts the raw token from /invite/[token]", () => {
    expect(inviteTokenFromPath("/invite/abc")).toBe("abc");
    expect(inviteTokenFromPath("/invite/a/b")).toBeNull();
    expect(inviteTokenFromPath("/admin")).toBeNull();
  });

  it("returns HTTP 410 for an expired token", async () => {
    const mem = memoryInvite(new Date("2026-01-01T00:00:00.000Z"), "stale-token");
    await createEmployeeWithInvite(
      {
        actor: admin,
        name: "Sam Hire",
        email: "sam@example.com",
        startDate: "2026-04-01",
      },
      mem.deps,
    );
    mem.clock.current = new Date("2026-01-08T00:00:00.000Z");
    const res = await gateInvitePath("/invite/stale-token", mem.deps);
    expect(res?.status).toBe(410);
    await expect(res?.text()).resolves.toContain("This invite is invalid or has expired.");
  });

  it("returns HTTP 404 for an unknown token", async () => {
    const mem = memoryInvite();
    const res = await gateInvitePath("/invite/missing", mem.deps);
    expect(res?.status).toBe(404);
  });
});

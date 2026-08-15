import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword as hashCredentialPassword } from "better-auth/crypto";
import { account, employees, invites, user } from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "./audit";
import type { EmployeeRole } from "./auth-gate";
import { canCreateEmployee, type AuthzActor } from "./authz";
import { getDb } from "./db";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set<EmployeeRole>(["employee", "manager", "admin"]);

export class DuplicateEmailError extends Error {
  readonly name = "DuplicateEmailError";
  constructor() {
    super("An employee with this email already exists");
  }
}

/** SHA-256 hex. Raw invite tokens are never stored. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiresAt(from: Date): Date {
  return new Date(from.getTime() + INVITE_TTL_MS);
}

export function isInviteExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export type RosterActor = AuthzActor & { orgId: string };

export type EmployeeRecord = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: string;
  startDate: string;
  mustChangePassword: boolean;
  authUserId: string | null;
};

export type InviteRecord = {
  id: string;
  employeeId: string;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdBy: string;
};

export type InviteStore = {
  insertEmployeeWithInvite(input: {
    employee: {
      orgId: string;
      email: string;
      name: string;
      role: EmployeeRole;
      startDate: string;
      mustChangePassword: boolean;
    };
    invite: {
      tokenHash: string;
      expiresAt: Date;
      createdBy: string;
    };
  }): Promise<{ employee: EmployeeRecord; invite: InviteRecord }>;
  findEmployeeById(id: string): Promise<EmployeeRecord | null>;
  replaceOpenInvite(input: {
    employeeId: string;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
    invalidateAt: Date;
  }): Promise<InviteRecord>;
  findOpenInviteByTokenHash(tokenHash: string): Promise<{
    invite: InviteRecord;
    employee: EmployeeRecord;
  } | null>;
  acceptInvite(input: {
    inviteId: string;
    employeeId: string;
    email: string;
    name: string;
    passwordHash: string;
    acceptedAt: Date;
  }): Promise<{ authUserId: string } | null>;
};

export type InviteDeps = {
  now?: () => Date;
  randomToken?: () => string;
  writeAudit?: AuditWriter;
  hashPassword?: (password: string) => Promise<string>;
  store: InviteStore;
};

export type CreateEmployeeInput = {
  actor: RosterActor | null;
  name: string;
  email: string;
  startDate: string;
  role?: string;
};

export type IssuedInvite = {
  ok: true;
  employeeId: string;
  inviteId: string;
  rawToken: string;
  invitePath: string;
};

export type CreateEmployeeResult =
  | IssuedInvite
  | { ok: false; status: 400 | 401 | 403; error: string };

export type IssueInviteResult =
  | IssuedInvite
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

export type AcceptInviteResult =
  | { ok: true; employeeId: string; email: string }
  | { ok: false; status: 400 | 404 | 410; error: string };

export type PreviewInviteResult =
  | { ok: true; name: string }
  | { ok: false; status: 404 | 410; error: string };

function parseRole(role: string | undefined): EmployeeRole | null {
  const value = (role ?? "employee") as EmployeeRole;
  return ROLES.has(value) ? value : null;
}

function parseCreateFields(input: CreateEmployeeInput) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const startDate = input.startDate.trim();
  const role = parseRole(input.role);
  if (!name) return { ok: false as const, error: "Name is required" };
  if (!EMAIL.test(email)) return { ok: false as const, error: "Valid email is required" };
  if (!ISO_DATE.test(startDate)) return { ok: false as const, error: "Start date must be YYYY-MM-DD" };
  if (!role) return { ok: false as const, error: "Invalid role" };
  return { ok: true as const, name, email, startDate, role };
}

export function pgInviteStore(db: ReturnType<typeof getDb> = getDb()): InviteStore {
  return {
    async insertEmployeeWithInvite(input) {
      try {
        return await db.transaction(async (tx) => {
          const [employee] = await tx
            .insert(employees)
            .values({
              orgId: input.employee.orgId,
              email: input.employee.email,
              name: input.employee.name,
              role: input.employee.role,
              startDate: input.employee.startDate,
              mustChangePassword: input.employee.mustChangePassword,
            })
            .returning();
          const [invite] = await tx
            .insert(invites)
            .values({
              employeeId: employee.id,
              tokenHash: input.invite.tokenHash,
              expiresAt: input.invite.expiresAt,
              createdBy: input.invite.createdBy,
            })
            .returning();
          return { employee, invite };
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new DuplicateEmailError();
        }
        throw err;
      }
    },
    async findEmployeeById(id) {
      const [row] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
      return row ?? null;
    },
    async replaceOpenInvite(input) {
      return db.transaction(async (tx) => {
        await tx
          .update(invites)
          .set({ expiresAt: input.invalidateAt })
          .where(and(eq(invites.employeeId, input.employeeId), isNull(invites.acceptedAt)));
        const [created] = await tx
          .insert(invites)
          .values({
            employeeId: input.employeeId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            createdBy: input.createdBy,
          })
          .returning();
        return created;
      });
    },
    async findOpenInviteByTokenHash(tokenHash) {
      const [row] = await db
        .select({
          invite: invites,
          employee: employees,
        })
        .from(invites)
        .innerJoin(employees, eq(employees.id, invites.employeeId))
        .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt)))
        .limit(1);
      if (!row) return null;
      return { invite: row.invite, employee: row.employee };
    },
    async acceptInvite(input) {
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(invites)
          .set({ acceptedAt: input.acceptedAt })
          .where(and(eq(invites.id, input.inviteId), isNull(invites.acceptedAt)))
          .returning({ id: invites.id });
        if (updated.length === 0) return null;

        const authUserId = crypto.randomUUID();
        await tx.insert(user).values({
          id: authUserId,
          name: input.name,
          email: input.email,
          emailVerified: true,
          createdAt: input.acceptedAt,
          updatedAt: input.acceptedAt,
        });
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: authUserId,
          providerId: "credential",
          userId: authUserId,
          password: input.passwordHash,
          createdAt: input.acceptedAt,
          updatedAt: input.acceptedAt,
        });
        await tx
          .update(employees)
          .set({ authUserId, mustChangePassword: false })
          .where(eq(employees.id, input.employeeId));
        return { authUserId };
      });
    },
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "23505"
  );
}

function resolveDeps(deps: InviteDeps) {
  return {
    now: deps.now ?? (() => new Date()),
    randomToken: deps.randomToken ?? generateInviteToken,
    writeAudit: deps.writeAudit ?? writeAuditEvent,
    hashPassword: deps.hashPassword ?? hashCredentialPassword,
    store: deps.store,
  };
}

async function denyUnlessAdmin(
  actor: RosterActor | null,
  writeAudit: AuditWriter,
): Promise<{ ok: true; actor: RosterActor } | { ok: false; status: 401 | 403; error: string }> {
  if (!actor) {
    return { ok: false, status: 401, error: "unauthenticated" };
  }
  if (!canCreateEmployee(actor)) {
    await tryWriteAudit(writeAudit, {
      actorId: actor.id,
      action: "idor.denied",
      entityType: "employee",
      after: { reason: "admin_required" },
    });
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, actor };
}

function issued(employeeId: string, inviteId: string, rawToken: string): IssuedInvite {
  return {
    ok: true,
    employeeId,
    inviteId,
    rawToken,
    invitePath: `/invite/${rawToken}`,
  };
}

export async function createEmployeeWithInvite(
  input: CreateEmployeeInput,
  deps: InviteDeps,
): Promise<CreateEmployeeResult> {
  const { now, randomToken, writeAudit, store } = resolveDeps(deps);
  const allowed = await denyUnlessAdmin(input.actor, writeAudit);
  if (!allowed.ok) return allowed;

  const parsed = parseCreateFields(input);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  const rawToken = randomToken();
  let created: { employee: EmployeeRecord; invite: InviteRecord };
  try {
    created = await store.insertEmployeeWithInvite({
      employee: {
        orgId: allowed.actor.orgId,
        email: parsed.email,
        name: parsed.name,
        role: parsed.role,
        startDate: parsed.startDate,
        mustChangePassword: false,
      },
      invite: {
        tokenHash: hashInviteToken(rawToken),
        expiresAt: inviteExpiresAt(now()),
        createdBy: allowed.actor.id,
      },
    });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  await tryWriteAudit(writeAudit, {
    actorId: allowed.actor.id,
    action: "employee.created",
    entityType: "employee",
    entityId: created.employee.id,
    after: { email: created.employee.email, role: created.employee.role, inviteId: created.invite.id },
  });

  return issued(created.employee.id, created.invite.id, rawToken);
}

export async function issueInvite(
  input: { actor: RosterActor | null; employeeId: string },
  deps: InviteDeps,
): Promise<IssueInviteResult> {
  const { now, randomToken, writeAudit, store } = resolveDeps(deps);
  const allowed = await denyUnlessAdmin(input.actor, writeAudit);
  if (!allowed.ok) return allowed;

  const employee = await store.findEmployeeById(input.employeeId);
  if (!employee || employee.orgId !== allowed.actor.orgId) {
    return { ok: false, status: 404, error: "Employee not found" };
  }
  if (employee.authUserId) {
    return { ok: false, status: 400, error: "Invite already accepted" };
  }

  const issuedAt = now();
  const rawToken = randomToken();
  const invite = await store.replaceOpenInvite({
    employeeId: employee.id,
    tokenHash: hashInviteToken(rawToken),
    expiresAt: inviteExpiresAt(issuedAt),
    createdBy: allowed.actor.id,
    invalidateAt: issuedAt,
  });

  await tryWriteAudit(writeAudit, {
    actorId: allowed.actor.id,
    action: "invite.reissued",
    entityType: "invite",
    entityId: invite.id,
    after: { employeeId: employee.id },
  });

  return issued(employee.id, invite.id, rawToken);
}

async function loadUsableInvite(
  rawToken: string,
  deps: InviteDeps,
): Promise<
  | { ok: true; invite: InviteRecord; employee: EmployeeRecord }
  | { ok: false; status: 404 | 410; error: string }
> {
  const { now, store } = resolveDeps(deps);
  const token = rawToken.trim();
  if (!token) {
    return { ok: false, status: 404, error: "This invite is invalid or has expired." };
  }

  const found = await store.findOpenInviteByTokenHash(hashInviteToken(token));
  if (!found) {
    return { ok: false, status: 404, error: "This invite is invalid or has expired." };
  }
  if (isInviteExpired(found.invite.expiresAt, now())) {
    return { ok: false, status: 410, error: "This invite is invalid or has expired." };
  }
  return { ok: true, invite: found.invite, employee: found.employee };
}

export async function previewInvite(rawToken: string, deps: InviteDeps): Promise<PreviewInviteResult> {
  const loaded = await loadUsableInvite(rawToken, deps);
  if (!loaded.ok) return loaded;
  return { ok: true, name: loaded.employee.name };
}

export async function acceptInvite(
  input: { rawToken: string; password: string },
  deps: InviteDeps,
): Promise<AcceptInviteResult> {
  const { now, writeAudit, hashPassword, store } = resolveDeps(deps);
  const password = input.password;
  if (password.length < 8) {
    return { ok: false, status: 400, error: "Password must be at least 6 characters" };
  }

  const loaded = await loadUsableInvite(input.rawToken, deps);
  if (!loaded.ok) return loaded;

  const passwordHash = await hashPassword(password);
  const accepted = await store.acceptInvite({
    inviteId: loaded.invite.id,
    employeeId: loaded.employee.id,
    email: loaded.employee.email,
    name: loaded.employee.name,
    passwordHash,
    acceptedAt: now(),
  });
  if (!accepted) {
    return { ok: false, status: 404, error: "This invite is invalid or has expired." };
  }

  await tryWriteAudit(writeAudit, {
    actorId: loaded.employee.id,
    action: "invite.accepted",
    entityType: "invite",
    entityId: loaded.invite.id,
    after: { employeeId: loaded.employee.id },
  });

  return { ok: true, employeeId: loaded.employee.id, email: loaded.employee.email };
}

export function defaultInviteDeps(): InviteDeps {
  return { store: pgInviteStore() };
}

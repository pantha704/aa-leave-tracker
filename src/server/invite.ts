import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
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
  insertEmployee(row: {
    orgId: string;
    email: string;
    name: string;
    role: EmployeeRole;
    startDate: string;
    mustChangePassword: boolean;
  }): Promise<EmployeeRecord>;
  insertInvite(row: {
    employeeId: string;
    tokenHash: string;
    expiresAt: Date;
    createdBy: string;
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
    password: string;
    acceptedAt: Date;
  }): Promise<{ authUserId: string } | null>;
};

export type InviteDeps = {
  now?: () => Date;
  randomToken?: () => string;
  writeAudit?: AuditWriter;
  store: InviteStore;
};

export type CreateEmployeeInput = {
  actor: RosterActor | null;
  name: string;
  email: string;
  startDate: string;
  role?: string;
};

export type CreateEmployeeResult =
  | { ok: true; employeeId: string; inviteId: string; rawToken: string; invitePath: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

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
    async insertEmployee(row) {
      try {
        const [created] = await db
          .insert(employees)
          .values({
            orgId: row.orgId,
            email: row.email,
            name: row.name,
            role: row.role,
            startDate: row.startDate,
            mustChangePassword: row.mustChangePassword,
          })
          .returning();
        return created;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new DuplicateEmailError();
        }
        throw err;
      }
    },
    async insertInvite(row) {
      const [created] = await db
        .insert(invites)
        .values({
          employeeId: row.employeeId,
          tokenHash: row.tokenHash,
          expiresAt: row.expiresAt,
          createdBy: row.createdBy,
        })
        .returning();
      return created;
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
        const passwordHash = await hashPassword(input.password);
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
          password: passwordHash,
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
    store: deps.store,
  };
}

export async function createEmployeeWithInvite(
  input: CreateEmployeeInput,
  deps: InviteDeps,
): Promise<CreateEmployeeResult> {
  const { now, randomToken, writeAudit, store } = resolveDeps(deps);
  const { actor } = input;

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

  const parsed = parseCreateFields(input);
  if (!parsed.ok) {
    return { ok: false, status: 400, error: parsed.error };
  }

  let employee: EmployeeRecord;
  try {
    employee = await store.insertEmployee({
      orgId: actor.orgId,
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      startDate: parsed.startDate,
      mustChangePassword: false,
    });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return { ok: false, status: 400, error: err.message };
    }
    throw err;
  }

  const rawToken = randomToken();
  const invite = await store.insertInvite({
    employeeId: employee.id,
    tokenHash: hashInviteToken(rawToken),
    expiresAt: inviteExpiresAt(now()),
    createdBy: actor.id,
  });

  await tryWriteAudit(writeAudit, {
    actorId: actor.id,
    action: "employee.created",
    entityType: "employee",
    entityId: employee.id,
    after: { email: employee.email, role: employee.role, inviteId: invite.id },
  });

  return {
    ok: true,
    employeeId: employee.id,
    inviteId: invite.id,
    rawToken,
    invitePath: `/invite/${rawToken}`,
  };
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
  const { now, writeAudit, store } = resolveDeps(deps);
  const password = input.password;
  if (password.length < 8) {
    return { ok: false, status: 400, error: "Password must be at least 8 characters" };
  }

  const loaded = await loadUsableInvite(input.rawToken, deps);
  if (!loaded.ok) return loaded;

  const accepted = await store.acceptInvite({
    inviteId: loaded.invite.id,
    employeeId: loaded.employee.id,
    email: loaded.employee.email,
    name: loaded.employee.name,
    password,
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

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { employees } from "@/db/schema";
import { getAuthzActor } from "./auth";
import { canAdmin, type AuthzActor } from "./authz";
import { getDb } from "./db";

export type AdminContext = {
  actor: AuthzActor;
  orgId: string;
};

export type AdminGateResult =
  | { ok: true; context: AdminContext }
  | { ok: false; status: 401 | 403; body: { error: string } };

export type AdminGateDeps = {
  getAuthzActor: (request: NextRequest) => Promise<AuthzActor | null>;
  loadOrgId: (actorId: string) => Promise<string | null>;
};

export async function loadActorOrgId(actorId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ orgId: employees.orgId })
    .from(employees)
    .where(eq(employees.id, actorId))
    .limit(1);
  return row?.orgId ?? null;
}

export const defaultAdminGateDeps: AdminGateDeps = {
  getAuthzActor,
  loadOrgId: loadActorOrgId,
};

export async function requireAdminApi(
  request: NextRequest,
  deps: AdminGateDeps = defaultAdminGateDeps,
): Promise<AdminGateResult> {
  const actor = await deps.getAuthzActor(request);
  if (!actor) {
    return { ok: false, status: 401, body: { error: "unauthenticated" } };
  }
  if (!canAdmin(actor)) {
    return { ok: false, status: 403, body: { error: "forbidden" } };
  }
  const orgId = await deps.loadOrgId(actor.id);
  if (!orgId) {
    return { ok: false, status: 403, body: { error: "forbidden" } };
  }
  return { ok: true, context: { actor, orgId } };
}

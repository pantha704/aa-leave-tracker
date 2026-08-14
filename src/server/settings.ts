import { eq } from "drizzle-orm";
import { orgSettings } from "@/db/schema";
import { tryWriteAudit, writeAuditEvent, type AuditWriter } from "@/server/audit";
import { getDb } from "@/server/db";

export const APP_READONLY_STATUS = 423;
export const APP_READONLY_CODE = "APP_READONLY";
export const APP_READONLY_MESSAGE = "The application is in read-only mode.";

export type OrgSettings = {
  orgId: string;
  appReadonly: boolean;
  selfLogEnabled: boolean;
  requestsEnabled: boolean;
  teamCalendarEnabled: boolean;
  accrualJobEnabled: boolean;
  emailEnabled: boolean;
};

export const DEFAULT_ORG_SETTINGS = {
  appReadonly: false,
  selfLogEnabled: true,
  requestsEnabled: true,
  teamCalendarEnabled: false,
  accrualJobEnabled: true,
  emailEnabled: false,
} as const;

export type SettingsStore = {
  get: (orgId: string) => Promise<OrgSettings | null>;
  upsertAppReadonly: (orgId: string, appReadonly: boolean) => Promise<OrgSettings>;
};

function withDefaults(orgId: string, row: Partial<OrgSettings> | null): OrgSettings {
  return {
    orgId,
    ...DEFAULT_ORG_SETTINGS,
    ...row,
  };
}

export function dbSettingsStore(db: ReturnType<typeof getDb> = getDb()): SettingsStore {
  return {
    async get(orgId) {
      const [row] = await db
        .select({
          orgId: orgSettings.orgId,
          appReadonly: orgSettings.appReadonly,
          selfLogEnabled: orgSettings.selfLogEnabled,
          requestsEnabled: orgSettings.requestsEnabled,
          teamCalendarEnabled: orgSettings.teamCalendarEnabled,
          accrualJobEnabled: orgSettings.accrualJobEnabled,
          emailEnabled: orgSettings.emailEnabled,
        })
        .from(orgSettings)
        .where(eq(orgSettings.orgId, orgId))
        .limit(1);
      return row ?? null;
    },

    async upsertAppReadonly(orgId, appReadonly) {
      const [row] = await db
        .insert(orgSettings)
        .values({ orgId, appReadonly })
        .onConflictDoUpdate({
          target: orgSettings.orgId,
          set: { appReadonly },
        })
        .returning({
          orgId: orgSettings.orgId,
          appReadonly: orgSettings.appReadonly,
          selfLogEnabled: orgSettings.selfLogEnabled,
          requestsEnabled: orgSettings.requestsEnabled,
          teamCalendarEnabled: orgSettings.teamCalendarEnabled,
          accrualJobEnabled: orgSettings.accrualJobEnabled,
          emailEnabled: orgSettings.emailEnabled,
        });
      return withDefaults(orgId, row);
    },
  };
}

export async function getOrgSettings(
  orgId: string,
  store: SettingsStore = dbSettingsStore(),
): Promise<OrgSettings> {
  return withDefaults(orgId, await store.get(orgId));
}

export async function isAppReadonly(
  orgId: string,
  store: SettingsStore = dbSettingsStore(),
): Promise<boolean> {
  return (await getOrgSettings(orgId, store)).appReadonly;
}

export async function setAppReadonly(input: {
  orgId: string;
  appReadonly: boolean;
  actorId?: string | null;
  store?: SettingsStore;
  writeAudit?: AuditWriter;
}): Promise<OrgSettings> {
  const store = input.store ?? dbSettingsStore();
  const before = await getOrgSettings(input.orgId, store);
  const after = await store.upsertAppReadonly(input.orgId, input.appReadonly);
  await tryWriteAudit(input.writeAudit ?? writeAuditEvent, {
    actorId: input.actorId ?? null,
    action: "settings.app_readonly",
    entityType: "org_settings",
    entityId: input.orgId,
    before: { appReadonly: before.appReadonly },
    after: { appReadonly: after.appReadonly },
  });
  return after;
}

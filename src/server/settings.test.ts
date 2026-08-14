import { describe, expect, it } from "vitest";
import type { AuditEventInput } from "@/server/audit";
import {
  DEFAULT_ORG_SETTINGS,
  getOrgSettings,
  isAppReadonly,
  setAppReadonly,
  type OrgSettings,
  type SettingsStore,
} from "./settings";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function memoryStore(seed: OrgSettings[] = []): SettingsStore {
  const rows = [...seed];
  return {
    async get(orgId) {
      return rows.find((row) => row.orgId === orgId) ?? null;
    },
    async upsertAppReadonly(orgId, appReadonly) {
      const idx = rows.findIndex((row) => row.orgId === orgId);
      if (idx < 0) {
        const created: OrgSettings = { orgId, ...DEFAULT_ORG_SETTINGS, appReadonly };
        rows.push(created);
        return created;
      }
      rows[idx] = { ...rows[idx], appReadonly };
      return rows[idx];
    },
  };
}

describe("org settings app_readonly", () => {
  it("defaults app_readonly to false when no row exists", async () => {
    const store = memoryStore();
    await expect(getOrgSettings(ORG, store)).resolves.toMatchObject({
      orgId: ORG,
      appReadonly: false,
    });
    await expect(isAppReadonly(ORG, store)).resolves.toBe(false);
  });

  it("reads and writes app_readonly", async () => {
    const events: AuditEventInput[] = [];
    const store = memoryStore();

    const frozen = await setAppReadonly({
      orgId: ORG,
      appReadonly: true,
      actorId: "admin",
      store,
      writeAudit: async (event) => {
        events.push(event);
      },
    });
    expect(frozen.appReadonly).toBe(true);
    await expect(isAppReadonly(ORG, store)).resolves.toBe(true);

    const thawed = await setAppReadonly({
      orgId: ORG,
      appReadonly: false,
      actorId: "admin",
      store,
      writeAudit: async (event) => {
        events.push(event);
      },
    });
    expect(thawed.appReadonly).toBe(false);
    expect(events).toEqual([
      expect.objectContaining({
        action: "settings.app_readonly",
        entityType: "org_settings",
        after: { appReadonly: true },
      }),
      expect.objectContaining({
        after: { appReadonly: false },
      }),
    ]);
  });
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, lt } from "drizzle-orm";
import { employees, leaveEntries, organizations } from "@/db/schema";
import { addIsoDays, asOfDateString } from "@/server/ledger/balance";
import { getDatabaseUrl, getDb } from "@/server/db";

export type LockCandidate = {
  id: string;
  status: string;
  endDate: string;
  immutableAt: Date | string | null;
};

export type LockOrg = {
  id: string;
  timezone: string;
  editWindowDays: number;
};

export type LockJobSource = {
  listOrgs: () => Promise<LockOrg[]>;
  listApprovedMutable: (orgId: string, cutoff: string) => Promise<LockCandidate[]>;
  setImmutableAt: (id: string, at: Date) => Promise<{ status: string } | undefined>;
};

export type LockJobResult = {
  asOf: string;
  orgs: number;
  considered: number;
  locked: number;
  skipped: number;
};

/** First civil date still inside the edit window (`today − edit_window_days`). */
export function lockCutoffDate(today: string, editWindowDays: number): string {
  return addIsoDays(today, -editWindowDays);
}

/**
 * Lock approved rows after `end_date < today − edit_window_days`.
 * Does not change status. Already-stamped rows stay skipped.
 */
export function shouldLockEntry(input: {
  status: string;
  endDate: string;
  immutableAt: Date | string | null;
  today: string;
  editWindowDays: number;
}): boolean {
  if (input.status !== "approved") return false;
  if (input.immutableAt != null) return false;
  return input.endDate < lockCutoffDate(input.today, input.editWindowDays);
}

export function pgLockSource(db: ReturnType<typeof getDb>): LockJobSource {
  return {
    async listOrgs() {
      return db
        .select({
          id: organizations.id,
          timezone: organizations.timezone,
          editWindowDays: organizations.editWindowDays,
        })
        .from(organizations);
    },
    async listApprovedMutable(orgId, cutoff) {
      return db
        .select({
          id: leaveEntries.id,
          status: leaveEntries.status,
          endDate: leaveEntries.endDate,
          immutableAt: leaveEntries.immutableAt,
        })
        .from(leaveEntries)
        .innerJoin(employees, eq(employees.id, leaveEntries.employeeId))
        .where(
          and(
            eq(employees.orgId, orgId),
            eq(leaveEntries.status, "approved"),
            isNull(leaveEntries.immutableAt),
            lt(leaveEntries.endDate, cutoff),
          ),
        );
    },
    async setImmutableAt(id, at) {
      const [row] = await db
        .update(leaveEntries)
        .set({ immutableAt: at })
        .where(
          and(
            eq(leaveEntries.id, id),
            eq(leaveEntries.status, "approved"),
            isNull(leaveEntries.immutableAt),
          ),
        )
        .returning({ status: leaveEntries.status });
      return row;
    },
  };
}

export async function runLockJob(
  now: Date | string = new Date(),
  source: LockJobSource = pgLockSource(getDb()),
): Promise<LockJobResult> {
  const orgs = await source.listOrgs();
  const instant = typeof now === "string" ? now : now;

  let considered = 0;
  let locked = 0;
  let skipped = 0;
  let asOfLabel = typeof now === "string" ? now : now.toISOString();

  for (const org of orgs) {
    const today = asOfDateString(instant, org.timezone);
    asOfLabel = today;
    const cutoff = lockCutoffDate(today, org.editWindowDays);
    const candidates = await source.listApprovedMutable(org.id, cutoff);
    const at = instant instanceof Date ? instant : new Date();

    for (const entry of candidates) {
      considered += 1;
      if (
        !shouldLockEntry({
          status: entry.status,
          endDate: entry.endDate,
          immutableAt: entry.immutableAt,
          today,
          editWindowDays: org.editWindowDays,
        })
      ) {
        skipped += 1;
        continue;
      }
      const updated = await source.setImmutableAt(entry.id, at);
      if (updated) locked += 1;
      else skipped += 1;
    }
  }

  return { asOf: asOfLabel, orgs: orgs.length, considered, locked, skipped };
}

function isExecutedAsScript(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

if (isExecutedAsScript()) {
  if (!getDatabaseUrl()) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runLockJob()
    .then((result) => {
      console.log(
        `lock asOf=${result.asOf} locked=${result.locked} considered=${result.considered} skipped=${result.skipped}`,
      );
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

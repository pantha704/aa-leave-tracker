import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { getDatabaseUrl } from "./env";

export { getDatabaseUrl };

type Db = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | undefined;
let db: Db | undefined;

export function getDb(): Db {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  if (!db) {
    client = postgres(url, { max: 10 });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function pingDatabase(url: string): Promise<boolean> {
  let sql: ReturnType<typeof postgres> | undefined;
  try {
    sql = postgres(url, { max: 1, connect_timeout: 5 });
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql?.end({ timeout: 5 });
  }
}

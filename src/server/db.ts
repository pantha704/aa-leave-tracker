import postgres from "postgres";

export function getDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  return url && url.length > 0 ? url : undefined;
}

export async function pingDatabase(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

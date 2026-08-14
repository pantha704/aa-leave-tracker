import postgres from "postgres";

export function getDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : undefined;
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

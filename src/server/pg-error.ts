export function pgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  if ("code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  if ("cause" in err) {
    return pgErrorCode((err as { cause: unknown }).cause);
  }
  return undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23503";
}

export function isInvalidText(err: unknown): boolean {
  return pgErrorCode(err) === "22P02";
}

export function isInvalidDate(err: unknown): boolean {
  const code = pgErrorCode(err);
  return code === "22007" || code === "22008";
}

export function isUndefinedTable(err: unknown): boolean {
  return pgErrorCode(err) === "42P01";
}

/** SEC-002: production privileged access is blocked until MFA is configured. */
export function privilegedMfaConfigured(
  env: Partial<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.PRIVILEGED_MFA === "1";
}

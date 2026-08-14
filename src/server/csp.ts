export type CspOptions = {
  nonce: string;
  nodeEnv?: string;
};

/** Complementary headers that do not need a per-request nonce. */
export const extraSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

/**
 * Production `script-src` uses a per-request nonce + `strict-dynamic` (no `'unsafe-inline'`).
 * `style-src` still allows `'unsafe-inline'` because React/Tailwind emit style attributes
 * and next/font injects CSS that is not reliably nonced.
 */
export function contentSecurityPolicy(opts: CspOptions): string {
  const isDev = (opts.nodeEnv ?? process.env.NODE_ENV) === "development";
  const script = isDev
    ? `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'`;
  const parts = [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

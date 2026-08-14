import {
  EMAIL_OFF_BANNER,
  shouldShowEmailBanner,
  type EmailEnv,
} from "@/server/notify";

export function AdminEmailBanner({ env = process.env }: { env?: EmailEnv }) {
  if (!shouldShowEmailBanner(env)) return null;
  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      role="status"
    >
      <p className="mx-auto w-full max-w-5xl">{EMAIL_OFF_BANNER}</p>
    </div>
  );
}

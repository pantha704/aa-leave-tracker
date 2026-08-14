import { notFound } from "next/navigation";
import { defaultInviteDeps, previewInvite } from "@/server/invite";
import { InviteForm } from "./invite-form";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await previewInvite(token, defaultInviteDeps());
  if (!preview.ok && preview.status === 404) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex w-full flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Accept invite</h1>
        {preview.ok ? (
          <>
            <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
              Welcome, {preview.name}. Set a password to sign in. There is no public registration.
            </p>
            <InviteForm token={token} />
          </>
        ) : (
          <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400" role="alert">
            {preview.error}
          </p>
        )}
      </main>
    </div>
  );
}

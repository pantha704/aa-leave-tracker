import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string }>;
}) {
  const { invited } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex w-full flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Absolute Addiction Leave
        </p>
        {invited ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Password set. Sign in with your work email.
          </p>
        ) : null}
        <LoginForm />
      </main>
    </div>
  );
}

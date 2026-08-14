export default function InviteNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex w-full flex-col items-center">
        <h1 className="text-2xl font-semibold tracking-tight">Accept invite</h1>
        <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400" role="alert">
          This invite is invalid or has expired.
        </p>
      </main>
    </div>
  );
}

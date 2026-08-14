export default function Forbidden() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          You are not allowed to access this page.
        </p>
      </main>
    </div>
  );
}

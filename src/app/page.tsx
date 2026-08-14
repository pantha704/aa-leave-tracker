export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Absolute Addiction Leave
        </h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          Internal leave tracker
        </p>
        <p className="mt-6">
          <a className="text-sm underline" href="/login">
            Sign in
          </a>
        </p>
      </main>
    </div>
  );
}

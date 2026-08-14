export function OpsBanner({ appReadonly }: { appReadonly: boolean }) {
  return (
    <div
      role="status"
      className={`border-b px-6 py-2 text-center text-sm ${
        appReadonly
          ? "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          : "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
      }`}
    >
      {appReadonly ? "App is frozen (readonly)" : "Dual-run: sheet is still source of truth"}
    </div>
  );
}

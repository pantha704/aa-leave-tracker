import { requireEmployee } from "@/server/auth";
import {
  defaultCalendarStore,
  isTeamCalendarOn,
  monthCells,
  parseCalendarMonth,
  readTeamCalendar,
  shiftYearMonth,
  type CalendarPerson,
} from "@/server/calendar";
import type { EmployeeRole } from "@/server/auth-gate";
import { setTeamCalendarEnabledAction, setTeamCalendarShowTypeAction } from "./actions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTH_LABEL = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

function monthHref(year: number, month: number): string {
  return `/calendar?year=${year}&month=${month}`;
}

function portionLabel(portion: string): string | null {
  if (portion === "am") return "AM";
  if (portion === "pm") return "PM";
  return null;
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { employee } = await requireEmployee();
  const params = await searchParams;
  const ctx = await defaultCalendarStore.loadOrgContext(employee.orgId);
  const parsed = parseCalendarMonth(
    typeof params.year === "string" ? params.year : undefined,
    typeof params.month === "string" ? params.month : undefined,
    ctx?.timezone ?? "UTC",
  );

  const isAdmin = employee.role === "admin";
  const yearMonth = "error" in parsed ? null : parsed;
  const cells = yearMonth ? monthCells(yearMonth.year, yearMonth.month) : [];
  const from = cells[0]?.date;
  const to = cells[cells.length - 1]?.date;

  const result =
    yearMonth && from && to
      ? await readTeamCalendar({
          actor: { id: employee.id, role: employee.role as EmployeeRole },
          orgId: employee.orgId,
          from,
          to,
        })
      : null;

  const enabled = isTeamCalendarOn(result);
  const showType = enabled ? result.body.showType : false;
  const peopleByDate = new Map<string, CalendarPerson[]>();
  if (enabled) {
    for (const person of result.body.people) {
      const list = peopleByDate.get(person.onDate) ?? [];
      list.push(person);
      peopleByDate.set(person.onDate, list);
    }
  }

  const prev = yearMonth ? shiftYearMonth(yearMonth.year, yearMonth.month, -1) : null;
  const next = yearMonth ? shiftYearMonth(yearMonth.year, yearMonth.month, 1) : null;
  const heading =
    yearMonth != null
      ? MONTH_LABEL.format(new Date(Date.UTC(yearMonth.year, yearMonth.month - 1, 1)))
      : "Calendar";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <a className="underline" href={employee.role === "admin" ? "/admin" : "/me"}>
              Home
            </a>
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Team calendar</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Who is out this month. Notes are never shown.
          </p>
        </div>
        {yearMonth && prev && next ? (
          <nav className="flex items-center gap-3 text-sm">
            <a className="underline" href={monthHref(prev.year, prev.month)}>
              Previous
            </a>
            <span className="font-medium">{heading}</span>
            <a className="underline" href={monthHref(next.year, next.month)}>
              Next
            </a>
          </nav>
        ) : null}
      </header>

      {"error" in parsed ? (
        <p className="text-sm text-red-600">{parsed.error}</p>
      ) : !enabled ? (
        <section className="rounded-lg border border-zinc-200 px-4 py-8 text-center dark:border-zinc-800">
          <h2 className="text-lg font-medium">Calendar off</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            The team calendar is turned off for this organization. An admin can enable it here.
          </p>
          {isAdmin ? (
            <form action={setTeamCalendarEnabledAction} className="mt-4">
              <input type="hidden" name="enabled" value="true" />
              <button className="underline" type="submit">
                Enable team calendar
              </button>
            </form>
          ) : null}
        </section>
      ) : (
        <>
          {isAdmin ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <form action={setTeamCalendarShowTypeAction}>
                <input type="hidden" name="showType" value={showType ? "false" : "true"} />
                <button className="underline" type="submit">
                  {showType ? "Hide leave type" : "Show leave type"}
                </button>
              </form>
              <form action={setTeamCalendarEnabledAction}>
                <input type="hidden" name="enabled" value="false" />
                <button className="underline" type="submit">
                  Turn calendar off
                </button>
              </form>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <div className="grid min-w-[40rem] grid-cols-7 gap-px bg-zinc-200 dark:bg-zinc-800">
              {WEEKDAYS.map((label) => (
                <div
                  key={label}
                  className="bg-zinc-100 px-2 py-2 text-xs font-medium dark:bg-zinc-900"
                >
                  {label}
                </div>
              ))}
              {cells.map((cell) => {
                const people = peopleByDate.get(cell.date) ?? [];
                return (
                  <div
                    key={cell.date}
                    className={`min-h-24 bg-[var(--background)] px-2 py-2 ${
                      cell.inMonth ? "" : "opacity-40"
                    }`}
                  >
                    <div className="text-xs tabular-nums text-zinc-500">
                      {cell.date.slice(8, 10)}
                    </div>
                    <ul className="mt-1 flex flex-col gap-1">
                      {people.map((person) => {
                        const half = portionLabel(person.portion);
                        const type = showType ? person.leaveTypeName : null;
                        return (
                          <li
                            key={`${person.employeeId}-${person.portion}-${type ?? "out"}`}
                            className="text-xs leading-snug"
                          >
                            <span className="font-medium">{person.name}</span>
                            <span className="text-zinc-600 dark:text-zinc-400">
                              {" "}
                              {type ?? "out"}
                              {half ? ` (${half})` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

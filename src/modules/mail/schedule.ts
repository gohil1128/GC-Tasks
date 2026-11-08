/*
  "Midnight in Winnipeg", on a scheduler that only speaks UTC.

  Winnipeg is UTC-6 in winter (CST) and UTC-5 in summer (CDT), and Vercel's
  Hobby crons run once a day each, somewhere within the hour asked for. So
  vercel.json asks for 05:00, 06:00 and 07:00 UTC, and this decides, from the
  local clock, which of those calls does the work:

    CDT: 05 UTC = 00h local, 06 = 01h, 07 = 02h
    CST: 05 UTC = 23h local (the day before), 06 = 00h, 07 = 01h

  The scan runs on the first call that lands in the local hours 00–01 for a
  day not yet scanned. If that scan ran out of time, a later call in the
  01 o'clock hour carries on with what is left. Everything else is a no-op.
*/

function parts(timeZone: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const get = (type: string) => f.formatToParts(at).find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

/** The calendar day at `at` in `timeZone`, "YYYY-MM-DD". */
export function dayIn(timeZone: string, at: Date): string {
  return parts(timeZone, at).day;
}

/** The hour 0–23 at `at` in `timeZone`. */
export function hourIn(timeZone: string, at: Date): number {
  return parts(timeZone, at).hour;
}

export type NightlyDecision =
  | { run: true; day: string; reason: "nightly" | "continue" }
  | { run: false; day: string; reason: string };

export function nightlyDecision(
  timeZone: string,
  now: Date,
  state: { nightlyDate: string | null; lastRunPartial: boolean },
): NightlyDecision {
  const { day, hour } = parts(timeZone, now);
  if (hour > 1) return { run: false, day, reason: `It is ${hour}:00 in ${timeZone}, not midnight.` };
  if (state.nightlyDate !== day) return { run: true, day, reason: "nightly" };
  if (hour === 1 && state.lastRunPartial) return { run: true, day, reason: "continue" };
  return { run: false, day, reason: "Tonight's scan has already run." };
}

/*
  "Midnight in Winnipeg", on a scheduler that only speaks UTC.

  Manitoba stopped changing its clocks on 1 November 2026: it stays on UTC-5
  all year ("Manitoba Standard Time"; IANA tzdata 2026e). Before that it was
  UTC-6 in winter and UTC-5 in summer. A runtime whose time-zone data predates
  2026e would still put winter Winnipeg at UTC-6 and scan an hour late, so
  from that date on the offset is pinned here rather than left to the
  runtime's copy of the data.

  vercel.json asks for 05:00, 06:00 and 07:00 UTC (Hobby crons run once a
  day each, somewhere within the hour asked for). Midnight is now the 05:00
  call; the others are 1 and 2 a.m. The scan runs on the first call that
  lands in the local hours 00–01 for a day not yet scanned. If that scan ran
  out of time, a later call in the 1 o'clock hour carries on with what is
  left. Everything else is a no-op. Keeping all three calls also covers the
  old UTC-6 winters, should Manitoba ever go back.
*/

/** When Manitoba's clocks would have fallen back for the last time (2 a.m. CDT, 1 Nov 2026). */
const MANITOBA_FIXED_FROM = Date.UTC(2026, 10, 1, 7, 0, 0);

/** The zone to read the clock in: Winnipeg from November 2026 is plain UTC-5, whatever the runtime's data says. */
function zoneAt(timeZone: string, at: Date): string {
  return timeZone === "America/Winnipeg" && at.getTime() >= MANITOBA_FIXED_FROM ? "Etc/GMT+5" : timeZone;
}

function parts(timeZone: string, at: Date) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: zoneAt(timeZone, at),
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

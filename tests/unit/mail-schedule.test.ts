import { describe, expect, it } from "vitest";
import { dayIn, hourIn, nightlyDecision } from "@/modules/mail/schedule";

/*
  Dates are chosen so the answer does not depend on which time-zone data the
  machine running the tests has: summers are UTC-5 in every version, winter
  2025 is UTC-6 in every version, and from November 2026 (Manitoba's
  year-round UTC-5) the offset is pinned in schedule.ts itself.
*/

const TZ = "America/Winnipeg";
const at = (iso: string) => new Date(iso);

describe("Winnipeg clock", () => {
  it("was UTC-5 in summer and UTC-6 in winter until 2026", () => {
    expect(hourIn(TZ, at("2026-07-01T05:10:00Z"))).toBe(0);
    expect(hourIn(TZ, at("2025-12-01T06:10:00Z"))).toBe(0);
    expect(dayIn(TZ, at("2025-12-01T05:30:00Z"))).toBe("2025-11-30");
  });

  it("stays on UTC-5 all year from November 2026, whatever the runtime's tz data", () => {
    expect(hourIn(TZ, at("2026-11-01T06:30:00Z"))).toBe(1); // 1:30 a.m., the hour that no longer repeats
    expect(hourIn(TZ, at("2026-12-01T05:10:00Z"))).toBe(0);
    expect(hourIn(TZ, at("2027-01-15T06:10:00Z"))).toBe(1);
    expect(dayIn(TZ, at("2026-12-01T05:30:00Z"))).toBe("2026-12-01");
  });
});

describe("which daily cron call is midnight", () => {
  const fresh = { nightlyDate: null, lastRunPartial: false };

  it("year-round UTC-5: the 05 UTC call scans, the 06 and 07 ones do not repeat it", () => {
    for (const day of ["2026-07-01", "2026-12-01"]) {
      expect(nightlyDecision(TZ, at(`${day}T05:20:00Z`), fresh)).toMatchObject({ run: true, reason: "nightly", day });
      const done = { nightlyDate: day, lastRunPartial: false };
      expect(nightlyDecision(TZ, at(`${day}T06:20:00Z`), done).run).toBe(false);
      expect(nightlyDecision(TZ, at(`${day}T07:20:00Z`), done).run).toBe(false);
    }
  });

  it("an old UTC-6 winter: the 05 UTC call is 11pm the day before and does nothing; 06 UTC scans", () => {
    expect(nightlyDecision(TZ, at("2025-12-01T05:59:00Z"), fresh).run).toBe(false);
    expect(nightlyDecision(TZ, at("2025-12-01T06:01:00Z"), fresh)).toMatchObject({ run: true, reason: "nightly", day: "2025-12-01" });
  });

  it("a late Hobby cron that lands at 00:59 still counts as midnight", () => {
    expect(nightlyDecision(TZ, at("2026-12-01T05:59:59Z"), fresh).run).toBe(true);
  });

  it("the 1 o'clock call carries on a scan that ran out of time, once tonight's has run", () => {
    expect(nightlyDecision(TZ, at("2026-12-01T06:10:00Z"), { nightlyDate: "2026-12-01", lastRunPartial: true })).toMatchObject({
      run: true,
      reason: "continue",
    });
    expect(nightlyDecision(TZ, at("2026-12-01T06:10:00Z"), { nightlyDate: "2026-12-01", lastRunPartial: false }).run).toBe(false);
  });

  it("if the midnight call never came, the 1 o'clock one does tonight's scan", () => {
    expect(nightlyDecision(TZ, at("2026-12-01T06:30:00Z"), { nightlyDate: "2026-11-30", lastRunPartial: false })).toMatchObject({
      run: true,
      reason: "nightly",
    });
  });

  it("never runs outside midnight–2am", () => {
    expect(nightlyDecision(TZ, at("2026-12-01T07:30:00Z"), { nightlyDate: "2026-11-30", lastRunPartial: true }).run).toBe(false);
    expect(nightlyDecision(TZ, at("2026-12-01T18:00:00Z"), fresh).run).toBe(false);
  });
});

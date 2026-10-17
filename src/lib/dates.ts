/*
  Due dates are calendar days, not instants. "Due Friday" means Friday
  wherever the reader is, so a due date is stored as UTC midnight of that day
  and always read back in UTC. Reading it in local time is the classic bug:
  a server in UTC and an owner in Toronto disagree about which day
  2026-10-17T00:00Z is, and the card shows Thursday.
*/

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-17" → Date at 2026-10-17T00:00:00Z, or null if not a real day. */
export function parseDay(value: string): Date | null {
  const m = DAY_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  // Reject 2026-02-31 and friends, which Date.UTC silently rolls over.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/** A stored due date → "2026-10-17", read in UTC. */
export function formatDay(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's calendar day where the reader is, as "YYYY-MM-DD". */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type DueState = "overdue" | "today" | "soon" | "later";

/**
  How urgent a due day is relative to the reader's today. Both sides are
  "YYYY-MM-DD" strings, which sort and compare correctly as text.
  "soon" is within the next two days.
*/
export function dueState(dueDay: string, today: string): DueState {
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  const t = parseDay(today);
  const due = parseDay(dueDay);
  if (t && due && due.getTime() - t.getTime() <= 2 * 86_400_000) return "soon";
  return "later";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-17" → "Oct 17", or "Oct 17, 2027" when not this year. */
export function shortDay(day: string, today: string): string {
  const d = parseDay(day);
  if (!d) return day;
  const label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${d.getUTCFullYear()}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(when: Date | string, now: Date = new Date()): string {
  const t = typeof when === "string" ? new Date(when) : when;
  const s = Math.max(0, Math.round((now.getTime() - t.getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${MONTHS[t.getMonth()]} ${t.getDate()}${t.getFullYear() === now.getFullYear() ? "" : `, ${t.getFullYear()}`}`;
}

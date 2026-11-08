/*
  Every tunable of the email-to-tasks scanner in one place, with the reason
  for each, so "why did it stop after 30 emails" has one answer you can find
  and changing it is a one-line diff.
*/

/** The nightly scan runs at midnight here. */
export const SCAN_TIME_ZONE = "America/Winnipeg";

/** First scan after connecting looks back this far, and no further. */
export const INITIAL_LOOKBACK_DAYS = 3;

/** However long the mailbox sat unscanned, never read back further than this. */
export const MAX_LOOKBACK_DAYS = 14;

/**
 * Each scan re-reads this much before where the last one finished. Mail can
 * arrive late, and ids already seen are skipped for free, so overlap costs a
 * list call, not a model call.
 */
export const OVERLAP_HOURS = 3;

/** Most emails read by the model in one run, so one flood cannot be a big bill. */
export const MAX_MESSAGES_PER_RUN = 60;

/** Emails read at once. Each is one Gmail fetch and one model call. */
export const CONCURRENCY = 4;

/**
 * Stop STARTING new emails after this long; the next run picks up the rest.
 * The function is allowed 60 seconds and one email can take 10–15, so the
 * budget leaves room for the slowest batch to finish rather than be killed
 * mid-email with a ledger row stuck on "processing".
 */
export const RUN_BUDGET_MS = 38_000;

/** A run that never reported finishing stops blocking the next one after this. */
export const RUN_LOCK_MS = 15 * 60_000;

/** A failing email is retried on later scans this many times, then left. */
export const MAX_ATTEMPTS = 3;

/** Bare "skipped" ids are only needed while the lookback can still list them. */
export const SKIPPED_RETENTION_DAYS = 30;

/** How much of an email body the model is shown. */
export const BODY_CHARS = 6_000;

/** Below this the model's "this needs doing" is not trusted to make a task. */
export const CONFIDENCE_MIN = 0.6;

/** Most tasks one run may create: a backstop against a misfire, not a quota. */
export const MAX_TASKS_PER_RUN = 25;

/** The label every task made from an email carries; created if missing. */
export const EMAIL_LABEL = { name: "Email", color: "blue" } as const;

/**
 * The model that reads each email. Override with MAIL_MODEL (for example a
 * cheaper one) without a code change.
 */
export const MAIL_MODEL = process.env.MAIL_MODEL || "claude-opus-5-5";

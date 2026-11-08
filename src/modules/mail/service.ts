import type { MailConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOwner, type Actor } from "@/lib/permissions";
import { createAnthropicClassifier } from "./classify";
import { SCAN_TIME_ZONE } from "./config";
import { decryptSecret, MailConfigError } from "./crypto";
import { createGmailClient, GmailAuthError, refreshAccessToken, revokeToken, type MailClient } from "./gmail";
import { scanMailbox, type ScanDeps, type ScanResult } from "./pipeline";
import { nightlyDecision } from "./schedule";

/*
  The entry points the routes and Settings call. Everything that decides
  anything is in pipeline.ts and schedule.ts, which take their dependencies as
  arguments so the tests run them against a fake mailbox and a fake model.
*/

export async function mailClientFor(connection: MailConnection): Promise<MailClient> {
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.refreshTokenEnc);
  } catch (e) {
    if (e instanceof MailConfigError) throw e;
    // Saved under a different MAIL_TOKEN_KEY, or damaged: only a new grant helps.
    throw new GmailAuthError("The saved Google connection can't be read. Connect the mailbox again.");
  }
  let token: string;
  try {
    token = await refreshAccessToken(refreshToken);
  } catch (e) {
    if (e instanceof GmailAuthError || e instanceof MailConfigError) throw e;
    throw new Error(`Could not reach Google: ${e instanceof Error ? e.message : String(e)}`);
  }
  return createGmailClient(token);
}

/** What still has to be set before "Connect Gmail" can work. Names only. */
export function missingConnectConfig(): string[] {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "MAIL_TOKEN_KEY"].filter((k) => !process.env[k]);
}

/** What still has to be set before a scan can work. Names only. */
export function missingConfig(): string[] {
  return [...missingConnectConfig(), ...(process.env.ANTHROPIC_API_KEY ? [] : ["ANTHROPIC_API_KEY"])];
}

/** The nightly call needs this too; Vercel sends it as the cron's bearer token. */
export function cronConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET);
}

export function productionDeps(): ScanDeps {
  return { db: prisma, mailFor: mailClientFor, classifier: createAnthropicClassifier() };
}

/**
 * Called by every daily cron hit. Decides from the Winnipeg clock whether
 * this is the midnight scan, and makes sure it runs once per night even when
 * two calls arrive together.
 */
export async function runNightly(deps: ScanDeps = productionDeps(), now: Date = new Date()): Promise<ScanResult & { decision: string }> {
  const connection = await deps.db.mailConnection.findUnique({ where: { id: 1 }, select: { nightlyDate: true } });
  const none = { ran: false, listed: 0, read: 0, tasks: 0, comments: 0, skipped: 0, failed: 0, partial: false };
  if (!connection) return { ...none, note: "No mailbox is connected.", decision: "skip" };

  const last = await deps.db.mailScanRun.findFirst({ orderBy: { startedAt: "desc" }, select: { partial: true } });
  const decision = nightlyDecision(SCAN_TIME_ZONE, now, {
    nightlyDate: connection.nightlyDate,
    lastRunPartial: Boolean(last?.partial),
  });
  if (!decision.run) return { ...none, note: decision.reason, decision: "skip" };

  if (decision.reason === "nightly") {
    // Claim tonight. Only one of two simultaneous calls gets the row.
    const claimed = await deps.db.mailConnection.updateMany({
      where: { id: 1, OR: [{ nightlyDate: null }, { nightlyDate: { not: decision.day } }] },
      data: { nightlyDate: decision.day },
    });
    if (claimed.count === 0) return { ...none, note: "Tonight's scan has already run.", decision: "skip" };
  }
  const result = await scanMailbox("nightly", { ...deps, now: () => new Date() });
  return { ...result, decision: decision.reason };
}

export async function scanNow(actor: Actor, deps: ScanDeps = productionDeps()): Promise<ScanResult> {
  if (!isOwner(actor)) throw new Error("FORBIDDEN");
  return scanMailbox("manual", deps);
}

/**
 * Stops scanning and forgets the grant. The ledger stays, so connecting the
 * same mailbox again does not turn the same emails into tasks a second time.
 */
export async function disconnectMailbox(actor: Actor): Promise<void> {
  if (!isOwner(actor)) throw new Error("FORBIDDEN");
  const existing = await prisma.mailConnection.findUnique({ where: { id: 1 } });
  if (!existing) return;
  await prisma.mailConnection.delete({ where: { id: 1 } });
  try {
    await revokeToken(decryptSecret(existing.refreshTokenEnc));
  } catch {
    /* without the key the grant can still be removed in the Google account */
  }
}

export type MailSettings = {
  connected: null | {
    accountEmail: string;
    status: string;
    statusNote: string | null;
    connectedByName: string;
    lastScanAt: string | null;
  };
  lastRun: null | {
    trigger: string;
    startedAt: string;
    finishedAt: string | null;
    read: number;
    tasks: number;
    comments: number;
    skipped: number;
    failed: number;
    partial: boolean;
    error: string | null;
  };
  missing: string[];
  cronReady: boolean;
};

export async function readMailSettings(): Promise<MailSettings> {
  const [c, run] = await Promise.all([
    prisma.mailConnection.findUnique({
      where: { id: 1 },
      select: {
        accountEmail: true, status: true, statusNote: true, lastScanAt: true,
        connectedBy: { select: { name: true } },
      },
    }),
    prisma.mailScanRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  return {
    connected: c
      ? {
          accountEmail: c.accountEmail,
          status: c.status,
          statusNote: c.statusNote,
          connectedByName: c.connectedBy.name,
          lastScanAt: c.lastScanAt?.toISOString() ?? null,
        }
      : null,
    lastRun: run
      ? {
          trigger: run.trigger,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          read: run.read,
          tasks: run.tasks,
          comments: run.comments,
          skipped: run.skipped,
          failed: run.failed,
          partial: run.partial,
          error: run.error,
        }
      : null,
    missing: missingConfig(),
    cronReady: cronConfigured(),
  };
}

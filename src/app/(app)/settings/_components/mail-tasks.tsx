"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { runAction } from "@/lib/action-client";
import { disconnectMailboxAction, scanNowAction } from "@/modules/mail/actions";
import type { MailSettings } from "@/modules/mail/service";

/*
  Owners only — the page does not render this for staff, and the actions and
  the connect route refuse them anyway.
*/

const RETURN_MESSAGES: Record<string, [kind: "success" | "error", text: string]> = {
  connected: ["success", "Mailbox connected. It will be scanned tonight at midnight."],
  denied: ["error", "Google sign-in was cancelled, so nothing was connected."],
  "bad-state": ["error", "That sign-in link had expired. Try Connect Gmail again."],
  "no-permission": ["error", "Google did not grant permission to read mail. Try again and leave the box ticked."],
  failed: ["error", "Couldn't connect the mailbox. Try again in a moment."],
  "not-configured": ["error", "Email scanning isn't set up on the server yet."],
};

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function MailTasks({ settings }: { settings: MailSettings }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = React.useState<"scan" | "disconnect" | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  // Say once how the trip to Google went, then drop it from the address bar.
  const back = params.get("mail");
  React.useEffect(() => {
    if (!back) return;
    const message = RETURN_MESSAGES[back];
    if (message) toast[message[0]](message[1]);
    router.replace("/settings#email-tasks", { scroll: false });
  }, [back, router]);

  const { connected, lastRun, missing } = settings;

  async function scan() {
    setBusy("scan");
    const result = await runAction(scanNowAction());
    setBusy(null);
    if (!result.ok) return;
    const r = result.data;
    if (!r.ran) toast.message(r.note ?? "Nothing to scan.");
    else if (r.error) toast.error(`The scan stopped: ${r.error}`);
    else {
      const made = r.tasks + r.comments;
      toast.success(
        made > 0
          ? `Read ${plural(r.read, "email")} — ${plural(r.tasks, "new task")}${r.comments ? `, ${plural(r.comments, "update")}` : ""}.`
          : `Read ${plural(r.read, "email")}. Nothing needs doing.`,
      );
    }
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    const result = await runAction(disconnectMailboxAction());
    setBusy(null);
    setConfirming(false);
    if (result.ok) {
      toast.success("Mailbox disconnected.");
      router.refresh();
    }
  }

  if (!connected) {
    return (
      <div className="grid gap-3">
        {missing.length > 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
            Not set up on the server yet. Add {missing.join(", ")} to the app&apos;s environment variables, then
            come back here to connect.
          </p>
        ) : (
          <div>
            <Button asChild>
              {/* A plain link, not fetch: the browser has to go to Google and back. */}
              <a href="/api/mail/google/connect">
                <Mail className="h-4 w-4" aria-hidden />
                Connect Gmail
              </a>
            </Button>
          </div>
        )}
      </div>
    );
  }

  const needsReconnect = connected.status !== "ACTIVE";
  return (
    <div className="grid gap-4">
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Mailbox</dt>
          <dd className="font-medium">{connected.accountEmail}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Tasks go to</dt>
          <dd>{connected.connectedByName}, in To do</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-muted-foreground">Last scan</dt>
          <dd>
            {when(connected.lastScanAt)}
            {lastRun && lastRun.finishedAt && !lastRun.error && (
              <span className="text-muted-foreground">
                {" "}
                · read {plural(lastRun.read, "email")}, {plural(lastRun.tasks, "task")} made
                {lastRun.comments ? `, ${plural(lastRun.comments, "update")}` : ""}
                {lastRun.failed ? `, ${lastRun.failed} failed` : ""}
                {lastRun.partial ? " (more left for next time)" : ""}
              </span>
            )}
          </dd>
        </div>
        {lastRun?.error && (
          <p className="text-sm text-destructive">The last scan stopped: {lastRun.error}</p>
        )}
      </dl>

      {needsReconnect && (
        <p className="rounded-2xl border border-destructive/40 px-4 py-3 text-sm">
          {connected.statusNote ?? "The mailbox needs to be connected again."}
        </p>
      )}
      {!settings.cronReady && (
        <p className="text-sm text-muted-foreground">
          The nightly scan is off until CRON_SECRET is set on the server. Scan now still works.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {needsReconnect ? (
          <Button asChild>
            <a href="/api/mail/google/connect">
              <Mail className="h-4 w-4" aria-hidden />
              Connect again
            </a>
          </Button>
        ) : (
          <Button onClick={scan} disabled={busy !== null || missing.length > 0}>
            <RefreshCw className={busy === "scan" ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
            {busy === "scan" ? "Scanning…" : "Scan now"}
          </Button>
        )}
        <Button variant="outline" onClick={() => setConfirming(true)} disabled={busy !== null}>
          <Unplug className="h-4 w-4" aria-hidden />
          Disconnect
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect the mailbox?"
        description="Scanning stops and the app's access to the mailbox is revoked. Tasks already made from email stay on the board."
        confirmLabel="Disconnect"
        pendingLabel="Disconnecting…"
        destructive
        onConfirm={disconnect}
      />
    </div>
  );
}

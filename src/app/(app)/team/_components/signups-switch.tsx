"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { runAction } from "@/lib/action-client";
import { cn } from "@/lib/utils";
import { setSignupsOpenAction } from "@/modules/team/actions";

/*
  The owners' switch for self sign-up. What it shows is what the server
  said (the page is refreshed after each flip), apart from the moment the
  click is in flight.

  Sign-up also needs email sending; without it the switch still records
  the owners' choice but says sign-up isn't offered, and why.
*/
export function SignupsSwitch({ open, emailReady }: { open: boolean; emailReady: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [shown, setShown] = React.useState(open);
  React.useEffect(() => setShown(open), [open]);

  async function flip() {
    const next = !shown;
    setBusy(true);
    setShown(next);
    const result = await runAction(setSignupsOpenAction(next));
    setBusy(false);
    if (!result.ok) {
      setShown(!next);
      return;
    }
    toast.success(next ? "Sign-ups are open." : "Sign-ups are closed.");
    router.refresh();
  }

  const live = shown && emailReady;

  return (
    <section aria-labelledby="signups-heading" className="mt-8 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="signups-heading" className="display text-lg font-semibold">
            Allow sign-ups
          </h2>
          <p id="signups-state" className="mt-0.5 text-sm text-muted-foreground">
            {!emailReady
              ? "Off: sign-up needs email sending, which isn't set up on this deployment."
              : live
                ? "Anyone with the link can create an account from the sign-in page. They join as Staff."
                : "Closed. The sign-in page doesn't offer an account to new people."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={shown}
          aria-labelledby="signups-heading"
          aria-describedby="signups-state"
          disabled={busy}
          onClick={() => void flip()}
          className={cn(
            "relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-60",
            shown ? "bg-espresso" : "bg-muted-foreground/30",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
              shown ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Staff see every task on the board. If someone you don&apos;t know signs up, deactivate them from their row
        below; they&apos;re signed out at once.
      </p>
    </section>
  );
}

"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelEmailChangeAction,
  confirmEmailChangeAction,
  requestEmailChangeAction,
} from "@/modules/auth/email-change-actions";

/*
  Settings → Email. Three states: the current address with a button; the
  new address and current password ("Send code"); then the code sent to the
  new address ("Confirm"). Nothing changes until the code is entered.
*/

type Step = { kind: "idle" } | { kind: "ask" } | { kind: "code"; newEmail: string };

function waitText(sec?: number): string {
  if (!sec) return "a few minutes";
  const mins = Math.ceil(sec / 60);
  return mins <= 1 ? "a minute" : `${mins} minutes`;
}

const inputClass = "h-11 text-base sm:text-sm";

export function EmailChangeForm({ email, enabled }: { email: string; enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>({ kind: "idle" });
  const [newEmail, setNewEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setStep({ kind: "idle" });
    setNewEmail("");
    setPassword("");
    setCode("");
    setError(null);
  }

  async function guarded<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const result = await guarded(() => requestEmailChangeAction({ newEmail, password }));
    if (!result) return;
    if (!result.ok) {
      setError(result.code === "LOCKED" ? `Too many attempts. Try again in ${waitText(result.retryAfterSec)}.` : result.error);
      return;
    }
    setPassword("");
    setStep({ kind: "code", newEmail: result.newEmail });
  }

  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || step.kind !== "code") return;
    const result = await guarded(() => confirmEmailChangeAction({ code }));
    if (!result) return;
    if (!result.ok) {
      setError(result.code === "LOCKED" ? `Too many attempts. Try again in ${waitText(result.retryAfterSec)}.` : result.error);
      return;
    }
    toast.success(`Email changed. Sign in with ${result.email} from now on.`);
    reset();
    router.refresh();
  }

  async function startOver() {
    await guarded(() => cancelEmailChangeAction());
    setCode("");
    setStep({ kind: "ask" });
  }

  if (!enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Changing your email needs email sending, which isn&apos;t set up yet. Ask an owner.
      </p>
    );
  }

  if (step.kind === "idle") {
    return (
      <Button variant="outline" onClick={() => setStep({ kind: "ask" })}>
        <Mail className="h-4 w-4" aria-hidden />
        Change email
      </Button>
    );
  }

  if (step.kind === "ask") {
    return (
      <form onSubmit={sendCode} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="new-email">New email</Label>
          <Input
            id="new-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email-change-password">Current password</Label>
          <Input
            id="email-change-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          We&apos;ll email a 6-digit code to the new address. Your email changes only once you enter it.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </Button>
          <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="grid gap-4">
      <p className="text-sm">
        We sent a 6-digit code to <span className="font-medium">{step.newEmail}</span>. It works for 10 minutes.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor="email-change-code">6-digit code</Label>
        <Input
          id="email-change-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={`${inputClass} tracking-[0.3em]`}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Confirming…" : "Confirm new email"}
        </Button>
        <Button type="button" variant="ghost" onClick={startOver} disabled={busy}>
          Use a different email
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Until then you still sign in with {email}.</p>
    </form>
  );
}

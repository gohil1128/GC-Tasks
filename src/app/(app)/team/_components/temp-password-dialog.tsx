"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COMPACT_DIALOG_CLASS } from "@/components/shell/confirm-dialog";

export type Reveal = { kind: "added" | "reset"; name: string; email: string; password: string };

/*
  The temporary password exists in exactly one place after this — the owner's
  screen — so the dialog will not close on a stray tap outside it. Only Done,
  the close button or Escape put it away, and once it is gone it is gone; the
  way back is another reset.
*/
export function TempPasswordDialog({ reveal, onClose }: { reveal: Reveal | null; onClose: () => void }) {
  return (
    <Dialog open={reveal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={COMPACT_DIALOG_CLASS} onInteractOutside={(e) => e.preventDefault()}>
        {reveal && <RevealBody reveal={reveal} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function RevealBody({ reveal, onClose }: { reveal: Reveal; onClose: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState(false);
  const first = reveal.name.split(/\s+/)[0] || reveal.name;

  async function copy() {
    try {
      await navigator.clipboard.writeText(reveal.password);
      setCopied(true);
      toast.success("Copied. Paste it somewhere only they will see it.");
    } catch {
      // No clipboard (an insecure origin, or permission refused): select it
      // so a long-press or Ctrl+C does the job instead.
      inputRef.current?.select();
      toast("Selected — copy it from the box.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{reveal.kind === "added" ? `${reveal.name} is on the team` : `New password for ${first}`}</DialogTitle>
        <DialogDescription>
          Here&apos;s their temporary password. It&apos;s shown only this once.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted p-2">
        <input
          ref={inputRef}
          readOnly
          value={reveal.password}
          aria-label="Temporary password"
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 font-mono text-lg tracking-wider text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="button" size="sm" variant="outline" onClick={copy} className="shrink-0">
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <ul className="grid list-disc gap-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
        <li>
          Share it with {first} privately — in person or in a direct message, not in a group chat.
        </li>
        <li>
          They sign in with <span className="font-medium text-foreground">{reveal.email}</span> and this password,
          then choose their own straight away.
        </li>
        <li>Lost it before they signed in? Use Reset password on their row for a new one.</li>
      </ul>

      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

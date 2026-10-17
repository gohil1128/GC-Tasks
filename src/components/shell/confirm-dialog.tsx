"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/*
  A short dialog rises from the bottom on a phone rather than taking the whole
  screen the way the task sheet does: there is a sentence and two buttons, and
  the thumb is already down there.
*/
export const COMPACT_DIALOG_CLASS =
  "top-auto max-h-[90dvh] rounded-t-bento pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:top-[18vh] sm:pb-6";

/**
  "Are you sure?" for anything that is hard to take back. `onConfirm` resolves
  to false to keep the dialog open (the action failed and has said why);
  anything else closes it. Closing is blocked while the action runs, so a
  stray tap cannot hide a request that is still in flight.
*/
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working…",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<boolean | void>;
}) {
  const [pending, setPending] = React.useState(false);

  async function confirm() {
    setPending(true);
    try {
      const keepOpen = (await onConfirm()) === false;
      if (!keepOpen) onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className={COMPACT_DIALOG_CLASS} hideClose>
        <DialogHeader className="pr-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 leading-relaxed">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={confirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

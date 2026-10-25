"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { afterSheetsClose, useBackToClose } from "@/components/ui/back-to-close";
import { useSwipeBack } from "@/components/ui/swipe-back";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/task/field";
import { runAction } from "@/lib/action-client";
import { shareIdeaAction } from "@/modules/ideas/actions";
import { IDEA_TITLE_MAX } from "@/modules/ideas/validation";
import { PostBox } from "./bits";

/**
  "Share an idea": a title, and as much or as little explanation as the
  person likes. On success it opens the new idea's thread, where the replies
  will land.
*/
export function ShareIdeaButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="brand" onClick={() => setOpen(true)} className="shrink-0">
        <Lightbulb className="h-4 w-4" aria-hidden />
        Share an idea
      </Button>
      <ShareIdeaDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function ShareIdeaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(pending);
  pendingRef.current = pending;
  const close = () => {
    if (!pendingRef.current) onOpenChange(false);
  };
  const attachSwipe = useSwipeBack(close, () => !pendingRef.current);
  useBackToClose(open, close);

  return (
    // Closing is held off while it is being saved, so a stray tap cannot hide a request still in flight.
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent
        ref={attachSwipe}
        className="touch-pan-y sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest("[data-escape-cancels]")) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Share an idea</DialogTitle>
          <DialogDescription>An idea, an opinion, something worth changing. The team can reply and upvote.</DialogDescription>
        </DialogHeader>
        {/* Mounted per opening, so each idea starts from an empty form. */}
        {open && <ShareIdeaForm pending={pending} setPending={setPending} onCancel={close} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareIdeaForm({
  pending,
  setPending,
  onCancel,
  onDone,
}: {
  pending: boolean;
  setPending: (pending: boolean) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const ids = { title: React.useId(), body: React.useId() };
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!title.trim() || pending) return;
    setPending(true);
    const result = await runAction(shareIdeaAction({ title, body }));
    setPending(false);
    if (!result.ok) return;
    onDone();
    afterSheetsClose(() => router.push(`/ideas/${result.data.id}`));
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={ids.title}>Title</FieldLabel>
        <Input
          id={ids.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={IDEA_TITLE_MAX}
          placeholder="e.g. Oat milk for the masala chai"
          autoComplete="off"
          disabled={pending}
          autoFocus
          className="h-10 text-[0.95rem]"
        />
      </div>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor={ids.body}>More detail (optional)</FieldLabel>
        <PostBox
          id={ids.body}
          value={body}
          onChange={setBody}
          onSubmit={() => void submit()}
          label="More detail (optional)"
          placeholder="Why it matters, how it could work…"
          disabled={pending}
          rows={4}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !title.trim()} aria-busy={pending || undefined}>
          {pending ? "Sharing…" : "Share idea"}
        </Button>
      </DialogFooter>
    </form>
  );
}

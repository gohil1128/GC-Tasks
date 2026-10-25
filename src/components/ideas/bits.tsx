"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowBigUp } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { isSubmitShortcut, useAutoGrow } from "@/components/task/hooks";
import { runAction } from "@/lib/action-client";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { setVoteAction } from "@/modules/ideas/actions";
import type { IdeaAuthor } from "@/modules/ideas/types";
import { IDEA_BODY_MAX } from "@/modules/ideas/validation";

/*
  The small pieces the Ideas list and thread pages share: the upvote pill,
  the "who · when" line, the multi-line box people write in, and the quiet
  text buttons under each post.
*/

export const DELETED = "[deleted]";

/**
  Upvote, Reddit-style but upvotes only. Optimistic — the count moves on the
  tap and settles to the server's answer — because a vote is cheap to get
  wrong and slow-feeling if it waits. On your own post, or a deleted one, it
  is just the count.

  Callers key it on the server's count and state, so a refresh with fresh
  numbers starts it over rather than fighting it.
*/
export function VoteButton({
  id,
  upvotes,
  upvotedByMe,
  canVote,
  size = "md",
  className,
}: {
  id: string;
  upvotes: number;
  upvotedByMe: boolean;
  canVote: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = React.useState({ upvotes, up: upvotedByMe });
  const [busy, setBusy] = React.useState(false);
  const label = `${state.upvotes} ${state.upvotes === 1 ? "upvote" : "upvotes"}`;
  const pill = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold tabular-nums",
    size === "sm" ? "h-8 pl-1.5 pr-2.5 text-xs" : "h-9 pl-2 pr-3 text-sm",
    className,
  );
  const icon = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  if (!canVote) {
    return (
      <span className={cn(pill, "text-muted-foreground")} title={label}>
        <ArrowBigUp className={icon} aria-hidden />
        <span aria-hidden>{state.upvotes}</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  async function toggle() {
    if (busy) return;
    const before = state;
    const up = !before.up;
    setState({ up, upvotes: before.upvotes + (up ? 1 : -1) });
    setBusy(true);
    const result = await runAction(setVoteAction(id, up));
    setBusy(false);
    if (result.ok) {
      setState({ up: result.data.upvotedByMe, upvotes: result.data.upvotes });
      router.refresh();
    } else {
      setState(before);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={state.up}
      aria-label={state.up ? `Upvoted · ${label}. Take back your upvote` : `Upvote · ${label}`}
      className={cn(
        pill,
        "border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        state.up
          ? "border-brand-strong/30 bg-brand-strong/10 text-brand-ink hover:bg-brand-strong/15"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <ArrowBigUp className={cn(icon, state.up && "fill-current")} aria-hidden />
      <span aria-hidden>{state.upvotes}</span>
    </button>
  );
}

/** Avatar, name, age and "(edited)"; "[deleted]" with an empty circle when the post was deleted. */
export function Byline({
  author,
  meId,
  createdAt,
  editedAt,
  now,
  size = "sm",
  children,
}: {
  author: IdeaAuthor | null;
  meId: string;
  createdAt: string;
  editedAt: string | null;
  now: Date;
  size?: "sm" | "md";
  /** Anything to show after the age, such as who a deep reply answers. */
  children?: React.ReactNode;
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      {author ? (
        <span aria-hidden>
          <Avatar person={author} size={size} />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn("inline-block shrink-0 rounded-full border border-dashed border-border bg-muted", size === "sm" ? "h-6 w-6" : "h-8 w-8")}
        />
      )}
      <span className={cn("font-semibold", !author && "font-normal text-muted-foreground")}>
        {author ? (author.id === meId ? "You" : author.name) : DELETED}
      </span>
      <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()} className="text-xs text-muted-foreground">
        {timeAgo(createdAt, now)}
      </time>
      {editedAt && (
        <span className="text-xs text-muted-foreground" title={`Edited ${new Date(editedAt).toLocaleString()}`}>
          (edited)
        </span>
      )}
      {children}
    </p>
  );
}

/** A multi-line box that grows as it fills. Ctrl/⌘+Enter sends; Escape cancels when there is something to cancel. */
export function PostBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  label,
  placeholder,
  autoFocus,
  disabled,
  id,
  rows = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  rows?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value);
  return (
    <Textarea
      ref={ref}
      id={id}
      value={value}
      rows={rows}
      maxLength={IDEA_BODY_MAX}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={label}
      placeholder={placeholder}
      data-escape-cancels={onCancel ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === "Escape" && onCancel) {
          e.preventDefault();
          onCancel();
        }
      }}
      className="max-h-80 min-h-[4.5rem] resize-none overflow-y-auto rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  );
}

/** The quiet text buttons under a post: Reply, Edit, Delete. */
export function PostAction({
  onClick,
  destructive,
  children,
  ...rest
}: {
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        destructive ? "hover:bg-destructive-muted hover:text-destructive" : "hover:bg-accent hover:text-foreground",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

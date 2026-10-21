"use client";
import * as React from "react";
import { MessageSquare } from "lucide-react";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { Avatar } from "@/components/ui/avatar";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { timeAgo } from "@/lib/dates";
import { canDeleteComment, canEditComment, type Actor } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { CommentDTO, BoardMember } from "@/modules/tasks/types";
import { isSubmitShortcut, useAutoGrow } from "./hooks";
import { wasEdited } from "./task-logic";

const COMMENT_MAX = 5_000;

const UNKNOWN: BoardMember = { id: "", name: "Someone", color: "slate", avatar: null, role: "STAFF", active: false };

function CommentBox({
  value,
  onChange,
  onSubmit,
  onCancel,
  label,
  placeholder,
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value);
  return (
    <Textarea
      ref={ref}
      value={value}
      rows={2}
      maxLength={COMMENT_MAX}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={label}
      placeholder={placeholder}
      // An edit in progress is cancelled by Escape; an unsent new comment is
      // kept, and Escape just leaves the box rather than closing the task.
      data-escape-cancels={onCancel || value ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (isSubmitShortcut(e)) {
          e.preventDefault();
          onSubmit();
        } else if (e.key === "Escape") {
          if (onCancel) {
            e.preventDefault();
            onCancel();
          } else if (value) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }
      }}
      className="max-h-80 min-h-[4.5rem] resize-none overflow-y-auto rounded-xl text-sm focus-visible:ring-2 focus-visible:ring-ring/50"
    />
  );
}

function CommentItem({
  comment,
  author,
  actor,
  now,
  canAct,
  onEdit,
  onRequestDelete,
}: {
  comment: CommentDTO;
  author: BoardMember;
  actor: Actor;
  now: Date;
  canAct: boolean;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onRequestDelete: (comment: CommentDTO) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const mine = comment.authorId === actor.id;
  const canEdit = canAct && canEditComment(actor, comment);
  const canDelete = canAct && canDeleteComment(actor, comment);

  async function save() {
    if (draft === null || saving) return;
    const body = draft.trim();
    if (!body) return;
    if (body === comment.body) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      if (await onEdit(comment.id, body)) setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="pt-0.5">
        <Avatar person={author} size="md" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{mine ? "You" : author.name}</span>
          <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()} className="text-xs text-muted-foreground">
            {timeAgo(comment.createdAt, now)}
          </time>
          {wasEdited(comment.createdAt, comment.updatedAt) && (
            <span className="text-xs text-muted-foreground" title={`Edited ${new Date(comment.updatedAt).toLocaleString()}`}>
              (edited)
            </span>
          )}
        </p>

        {draft !== null ? (
          <div className="mt-1.5 space-y-2">
            <CommentBox
              value={draft}
              onChange={setDraft}
              onSubmit={() => void save()}
              onCancel={() => setDraft(null)}
              label="Edit your comment"
              autoFocus
              disabled={saving}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !draft.trim()} aria-busy={saving || undefined}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"><LinkifiedText text={comment.body} /></p>
            {(canEdit || canDelete) && (
              <div className="mt-1 flex gap-1">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setDraft(comment.body)}
                    className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Edit<span className="sr-only"> your comment</span>
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onRequestDelete(comment)}
                    className="rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Delete<span className="sr-only">{mine ? " your comment" : ` ${author.name}'s comment`}</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
  The conversation on a task. Anyone may comment on a live task; people edit
  only their own words, and delete their own (owners may delete anyone's, to
  keep the board tidy). Nothing here is optimistic: a comment appears once
  the server has it, so what you see is what everyone else will see.
*/
export function Comments({
  comments,
  members,
  actor,
  now,
  canComment,
  loading,
  onAdd,
  onEdit,
  onDelete,
}: {
  comments: CommentDTO[];
  members: BoardMember[];
  actor: Actor;
  now: Date;
  /** False on an archived task: the thread is shown, but frozen. */
  canComment: boolean;
  loading?: boolean;
  onAdd: (body: string) => Promise<boolean>;
  onEdit: (id: string, body: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const headingId = React.useId();
  const [body, setBody] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [deleting, setDeleting] = React.useState<CommentDTO | null>(null);
  const byId = React.useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  async function post() {
    const clean = body.trim();
    if (!clean || posting) return;
    setPosting(true);
    try {
      if (await onAdd(clean)) setBody("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        Comments
        {comments.length > 0 && <span className="font-normal text-muted-foreground">{comments.length}</span>}
      </h3>

      {loading ? (
        <div className="flex gap-2.5" aria-hidden>
          <div className="h-8 w-8 animate-pulse rounded-full bg-beige-deep" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-1/3 animate-pulse rounded bg-beige-deep" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-beige-deep" />
          </div>
        </div>
      ) : comments.length > 0 ? (
        <ul className="space-y-4">
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              author={byId.get(c.authorId) ?? UNKNOWN}
              actor={actor}
              now={now}
              canAct={canComment}
              onEdit={onEdit}
              onRequestDelete={setDeleting}
            />
          ))}
        </ul>
      ) : (
        !canComment && <p className="text-sm text-muted-foreground">No comments.</p>
      )}

      {canComment && !loading && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void post();
          }}
        >
          <CommentBox
            value={body}
            onChange={setBody}
            onSubmit={() => void post()}
            label="Write a comment"
            placeholder={comments.length ? "Reply…" : "Write a comment…"}
            disabled={posting}
          />
          <div className="flex items-center justify-between gap-3">
            <p className={cn("hidden text-2xs text-muted-foreground sm:block", !body.trim() && "invisible")}>
              Ctrl or ⌘ + Enter to send
            </p>
            <Button type="submit" size="sm" className="ml-auto" disabled={posting || !body.trim()} aria-busy={posting || undefined}>
              {posting ? "Posting…" : "Comment"}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this comment?"
        description={
          deleting && deleting.authorId !== actor.id
            ? `${byId.get(deleting.authorId)?.name ?? "Someone"}'s comment will be removed for everyone. This can't be undone.`
            : "It will be removed for everyone. This can't be undone."
        }
        confirmLabel="Delete comment"
        pendingLabel="Deleting…"
        destructive
        onConfirm={async () => (deleting ? onDelete(deleting.id) : true)}
      />
    </section>
  );
}

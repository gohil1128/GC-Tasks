"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronRight, CornerDownRight, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LinkifiedText } from "@/components/ui/linkified-text";
import { useNow } from "@/components/task/hooks";
import { runAction } from "@/lib/action-client";
import { canDeleteIdea, canEditIdea, canReplyToIdea, canVoteIdea, type Actor, type IdeaAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { deleteIdeaAction, editIdeaAction, replyToIdeaAction } from "@/modules/ideas/actions";
import { countDescendants, indentFor } from "@/modules/ideas/thread";
import type { IdeaPost, IdeaThread, ReplyNode } from "@/modules/ideas/types";
import { IDEA_TITLE_MAX } from "@/modules/ideas/validation";
import { Byline, DELETED, PostAction, PostBox, VoteButton } from "./bits";
import { AddPhotosButton, PhotoDraftStrip, PhotoGallery, usePhotoDrafts } from "./photos";

/*
  One idea and its replies, Reddit-style: the idea on top, then the replies
  as a tree, each indented under the one it answers with a thin line down
  its left that collapses the branch when tapped.

  Nothing is copied into state beyond what is being typed: after every write
  the page is refreshed and re-read, so the tree is always what the database
  says — including what teammates did in the meantime.
*/

type Ctx = {
  actor: Actor;
  now: Date;
  /** Asks to delete a post; the confirm dialog lives once, at the top. */
  requestDelete: (post: IdeaPost, hasReplies: boolean) => void;
  refresh: () => void;
};

const ThreadContext = React.createContext<Ctx | null>(null);

function useThread(): Ctx {
  const ctx = React.useContext(ThreadContext);
  if (!ctx) throw new Error("useThread outside IdeaThreadView");
  return ctx;
}

function accessOf(post: IdeaPost): IdeaAccess {
  return { authorId: post.authorId, deleted: post.deleted };
}

export function IdeaThreadView({ thread, actor }: { thread: IdeaThread; actor: Actor }) {
  const router = useRouter();
  const now = new Date(useNow());
  const [deleting, setDeleting] = React.useState<{ post: IdeaPost; hasReplies: boolean } | null>(null);
  const { idea, replies, replyCount } = thread;

  const ctx: Ctx = {
    actor,
    now,
    requestDelete: (post, hasReplies) => setDeleting({ post, hasReplies }),
    refresh: () => router.refresh(),
  };

  async function confirmDelete(): Promise<boolean> {
    if (!deleting) return true;
    const result = await runAction(deleteIdeaAction(deleting.post.id));
    if (!result.ok) return false;
    const isIdea = deleting.post.parentId === null;
    if (result.data.ideaGone) {
      toast.success("Idea deleted.");
      router.push("/ideas");
    } else {
      toast.success(isIdea ? "Idea deleted. Its replies stay." : "Reply deleted.");
      router.refresh();
    }
    return true;
  }

  const deletingWhat = deleting?.post.parentId === null ? "idea" : "reply";
  const someoneElse = deleting && deleting.post.authorId !== actor.id ? deleting.post.author?.name : null;

  return (
    <ThreadContext.Provider value={ctx}>
      <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-5 sm:px-6 sm:py-8">
        <Link
          href="/ideas"
          className="inline-flex w-fit items-center gap-1.5 rounded-full text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          All ideas
        </Link>

        <IdeaCard idea={idea} hasReplies={replies.length > 0} />

        <section aria-labelledby="replies-heading" className="grid gap-4">
          <h2 id="replies-heading" className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
            {replyCount === 0 ? "Replies" : `${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
          </h2>

          {canReplyToIdea(actor, accessOf(idea)) && <TopReplyForm ideaId={idea.id} first={replies.length === 0} />}

          {replies.length > 0 ? (
            <ul className="grid gap-4">
              {replies.map((node) => (
                <ReplyItem key={node.id} node={node} depth={0} parentName={null} />
              ))}
            </ul>
          ) : (
            idea.deleted && <p className="text-sm text-muted-foreground">No replies.</p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete this ${deletingWhat}?`}
        description={
          <>
            {someoneElse && <p>{`${someoneElse}'s ${deletingWhat} will be deleted for everyone.`}</p>}
            <p>
              {deleting?.hasReplies
                ? `The replies stay; the ${deletingWhat} will show as ${DELETED}. This can't be undone.`
                : "It will be removed for everyone. This can't be undone."}
            </p>
          </>
        }
        confirmLabel={`Delete ${deletingWhat}`}
        pendingLabel="Deleting…"
        destructive
        onConfirm={confirmDelete}
      />
    </ThreadContext.Provider>
  );
}

// ── The idea itself ─────────────────────────────────────────────────────

function IdeaCard({ idea, hasReplies }: { idea: IdeaPost; hasReplies: boolean }) {
  const { actor, now, requestDelete, refresh } = useThread();
  const [editing, setEditing] = React.useState(false);
  const access = accessOf(idea);
  const canEdit = canEditIdea(actor, access);
  const canDelete = canDeleteIdea(actor, access);

  return (
    <article className="rounded-bento border border-border bg-card p-4 shadow-card sm:p-6">
      <Byline author={idea.author} meId={actor.id} createdAt={idea.createdAt} editedAt={idea.editedAt} now={now} size="md" />
      {editing ? (
        <EditIdeaForm
          idea={idea}
          onDone={() => {
            setEditing(false);
            refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <h1 className="display mt-3 text-2xl font-semibold leading-tight [overflow-wrap:anywhere] sm:text-3xl">{idea.title}</h1>
          {idea.deleted ? (
            <p className="mt-2 text-sm italic text-muted-foreground">{DELETED}</p>
          ) : (
            idea.body && (
              <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-relaxed [overflow-wrap:anywhere]">
                <LinkifiedText text={idea.body} />
              </p>
            )
          )}
          <PhotoGallery photos={idea.photos} label="this idea" className="mt-3" />
          <div className="mt-4 flex flex-wrap items-center gap-1">
            <VoteButton
              key={`${idea.id}:${idea.upvotes}:${idea.upvotedByMe}`}
              id={idea.id}
              upvotes={idea.upvotes}
              upvotedByMe={idea.upvotedByMe}
              canVote={canVoteIdea(actor, access)}
              className="mr-1"
            />
            {canEdit && <PostAction onClick={() => setEditing(true)}>Edit<span className="sr-only"> your idea</span></PostAction>}
            {canDelete && (
              <PostAction destructive onClick={() => requestDelete(idea, hasReplies)}>
                Delete<span className="sr-only">{idea.authorId === actor.id ? " your idea" : ` ${idea.author?.name}'s idea`}</span>
              </PostAction>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function EditIdeaForm({ idea, onDone, onCancel }: { idea: IdeaPost; onDone: () => void; onCancel: () => void }) {
  const titleId = React.useId();
  const [title, setTitle] = React.useState(idea.title ?? "");
  const [body, setBody] = React.useState(idea.body);
  const [saving, setSaving] = React.useState(false);
  const photos = usePhotoDrafts(idea.photos);
  const blocked = photos.uploading || photos.failed;

  async function save(event?: React.FormEvent) {
    event?.preventDefault();
    if (!title.trim() || saving || blocked) return;
    const samePhotos = photos.ids.join() === idea.photos.map((p) => p.id).join();
    if (title.trim() === idea.title && body.trim() === idea.body && samePhotos) return onCancel();
    setSaving(true);
    const result = await runAction(editIdeaAction({ id: idea.id, title, body, photoIds: photos.ids }));
    setSaving(false);
    if (result.ok) onDone();
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mt-3 grid gap-2">
      <label htmlFor={titleId} className="sr-only">
        Title
      </label>
      <Input
        id={titleId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={IDEA_TITLE_MAX}
        disabled={saving}
        autoFocus
        className="h-10 text-[0.95rem] font-semibold"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <PostBox
        value={body}
        onChange={setBody}
        onSubmit={() => void save()}
        onCancel={onCancel}
        label="Edit the detail of your idea"
        placeholder="More detail (optional)"
        disabled={saving}
        rows={3}
      />
      <PhotoDraftStrip photos={photos} disabled={saving} />
      <div className="flex flex-wrap items-center gap-2">
        <AddPhotosButton photos={photos} disabled={saving} />
        <Button type="submit" size="sm" disabled={saving || blocked || !title.trim()} aria-busy={saving || undefined} className="ml-auto">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Replies ─────────────────────────────────────────────────────────────

/** A box for writing a reply, with Reply and (optionally) Cancel. Resolves true once posted. */
function ReplyForm({
  parentId,
  label,
  placeholder,
  autoFocus,
  onCancel,
  onPosted,
}: {
  parentId: string;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onPosted: () => void;
}) {
  const { refresh } = useThread();
  const [body, setBody] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const photos = usePhotoDrafts();
  const hasSomething = body.trim().length > 0 || photos.ids.length > 0;
  const blocked = photos.uploading || photos.failed;

  async function post(event?: React.FormEvent) {
    event?.preventDefault();
    if (!hasSomething || posting || blocked) return;
    setPosting(true);
    const result = await runAction(replyToIdeaAction(parentId, body, photos.ids));
    setPosting(false);
    if (!result.ok) return;
    setBody("");
    photos.reset();
    onPosted();
    refresh();
  }

  return (
    <form onSubmit={(e) => void post(e)} className="grid gap-2">
      <PostBox
        value={body}
        onChange={setBody}
        onSubmit={() => void post()}
        onCancel={onCancel}
        label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={posting}
      />
      <PhotoDraftStrip photos={photos} disabled={posting} />
      <div className="flex items-center gap-2">
        <AddPhotosButton photos={photos} disabled={posting} />
        <p className={cn("hidden text-2xs text-muted-foreground sm:block", !body.trim() && "invisible")}>
          Ctrl or ⌘ + Enter to send
        </p>
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={posting}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={posting || blocked || !hasSomething} aria-busy={posting || undefined}>
            {posting ? "Replying…" : photos.uploading ? "Uploading…" : "Reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function TopReplyForm({ ideaId, first }: { ideaId: string; first: boolean }) {
  return (
    <ReplyForm
      parentId={ideaId}
      label="Reply to this idea"
      placeholder={first ? "Be the first to reply…" : "Add your thoughts…"}
      onPosted={() => undefined}
    />
  );
}

/**
  One reply and everything under it. Its children sit one step to the right,
  behind a thin line that collapses the branch — up to MAX_INDENT_DEPTH
  steps; deeper than that they line up under their parent and say who they
  answer instead, so a long back-and-forth stays readable on a phone.
*/
function ReplyItem({ node, depth, parentName }: { node: ReplyNode; depth: number; parentName: string | null }) {
  const { actor, now, requestDelete, refresh } = useThread();
  const [collapsed, setCollapsed] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const access = accessOf(node);
  const mine = node.authorId === actor.id;
  const name = node.author ? (mine ? "you" : node.author.name) : DELETED;
  const hidden = countDescendants(node);
  const childrenIndent = indentFor(depth + 1) > indentFor(depth);
  const toggleLabel = `${collapsed ? "Expand" : "Collapse"} reply by ${name}`;

  return (
    <li className="min-w-0">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
        </button>
        <Byline author={node.author} meId={actor.id} createdAt={node.createdAt} editedAt={node.editedAt} now={now}>
          {parentName !== null && (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <CornerDownRight className="h-3 w-3" aria-hidden />
              {parentName}
            </span>
          )}
          {collapsed && (
            <span className="text-xs text-muted-foreground">
              {node.upvotes > 0 && `${node.upvotes} ▲ · `}
              {hidden > 0 ? `+${hidden} more` : "hidden"}
            </span>
          )}
        </Byline>
      </div>

      {!collapsed && (
        <div className="pl-7">
          {editing ? (
            <EditReplyForm
              node={node}
              onCancel={() => setEditing(false)}
              onDone={() => {
                setEditing(false);
                refresh();
              }}
            />
          ) : node.deleted ? (
            <p className="mt-0.5 text-sm italic text-muted-foreground">{DELETED}</p>
          ) : (
            <>
              {node.body && (
                <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                  <LinkifiedText text={node.body} />
                </p>
              )}
              <PhotoGallery photos={node.photos} label={`the reply by ${name}`} className="mt-2 max-w-sm" />
            </>
          )}

          {!editing && (
            <div className="-ml-1 mt-1 flex flex-wrap items-center gap-0.5">
              <VoteButton
                key={`${node.id}:${node.upvotes}:${node.upvotedByMe}`}
                id={node.id}
                upvotes={node.upvotes}
                upvotedByMe={node.upvotedByMe}
                canVote={canVoteIdea(actor, access)}
                size="sm"
                className="mr-1"
              />
              {canReplyToIdea(actor, access) && (
                <PostAction onClick={() => setReplying((r) => !r)} aria-expanded={replying}>
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  Reply<span className="sr-only"> to {name}</span>
                </PostAction>
              )}
              {canEditIdea(actor, access) && (
                <PostAction onClick={() => setEditing(true)}>
                  Edit<span className="sr-only"> your reply</span>
                </PostAction>
              )}
              {canDeleteIdea(actor, access) && (
                <PostAction destructive onClick={() => requestDelete(node, node.replies.length > 0)}>
                  Delete<span className="sr-only">{mine ? " your reply" : ` ${name}'s reply`}</span>
                </PostAction>
              )}
            </div>
          )}

          {replying && (
            <div className="mt-2">
              <ReplyForm
                parentId={node.id}
                label={`Reply to ${name}`}
                placeholder={`Reply to ${name}…`}
                autoFocus
                onCancel={() => setReplying(false)}
                onPosted={() => setReplying(false)}
              />
            </div>
          )}
        </div>
      )}

      {!collapsed && node.replies.length > 0 && (
        <div className={cn("relative mt-3", childrenIndent && "pl-6")}>
          {childrenIndent && (
            // The Reddit thread line: a wide, invisible hit area around a thin
            // rule. Mouse and touch only — the chevron is the keyboard's way.
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => setCollapsed(true)}
              className="group absolute bottom-0 left-0 top-0 flex w-6 justify-center"
            >
              <span className="h-full w-0.5 rounded-full bg-border transition-colors group-hover:bg-foreground/40" />
            </button>
          )}
          <ul className="grid gap-4">
            {node.replies.map((child) => (
              <ReplyItem
                key={child.id}
                node={child}
                depth={depth + 1}
                parentName={childrenIndent ? null : node.author ? (mine ? "You" : node.author.name) : DELETED}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Editing your reply: its words and its photos. It has to keep one or the other. */
function EditReplyForm({ node, onDone, onCancel }: { node: ReplyNode; onDone: () => void; onCancel: () => void }) {
  const [draft, setDraft] = React.useState(node.body);
  const [saving, setSaving] = React.useState(false);
  const photos = usePhotoDrafts(node.photos);
  const blocked = photos.uploading || photos.failed;
  const hasSomething = draft.trim().length > 0 || photos.ids.length > 0;

  async function save() {
    if (saving || blocked || !hasSomething) return;
    const body = draft.trim();
    const samePhotos = photos.ids.join() === node.photos.map((p) => p.id).join();
    if (body === node.body && samePhotos) return onCancel();
    setSaving(true);
    const result = await runAction(editIdeaAction({ id: node.id, body, photoIds: photos.ids }));
    setSaving(false);
    if (result.ok) onDone();
  }

  return (
    <div className="mt-1.5 grid gap-2">
      <PostBox
        value={draft}
        onChange={setDraft}
        onSubmit={() => void save()}
        onCancel={onCancel}
        label="Edit your reply"
        autoFocus
        disabled={saving}
      />
      <PhotoDraftStrip photos={photos} disabled={saving} />
      <div className="flex flex-wrap items-center gap-2">
        <AddPhotosButton photos={photos} disabled={saving} />
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving || blocked || !hasSomething} aria-busy={saving || undefined} className="ml-auto">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

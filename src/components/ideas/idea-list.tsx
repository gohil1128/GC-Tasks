"use client";
import Link from "next/link";
import { Lightbulb, MessageSquare } from "lucide-react";
import { useNow } from "@/components/task/hooks";
import { canVoteIdea } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { IDEA_SORTS, IDEA_SORT_LABEL, type IdeaSort, type IdeaSummary } from "@/modules/ideas/types";
import { Byline, DELETED, VoteButton } from "./bits";

/** Top / New, as links so the choice lives in the URL and survives a refresh. */
export function SortToggle({ sort }: { sort: IdeaSort }) {
  return (
    <nav aria-label="Sort ideas" className="inline-flex rounded-full bg-beige-deep/60 p-1">
      {IDEA_SORTS.map((option) => {
        const active = option === sort;
        return (
          <Link
            key={option}
            href={option === "top" ? "/ideas" : `/ideas?sort=${option}`}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-card text-foreground shadow-card",
            )}
          >
            {IDEA_SORT_LABEL[option]}
          </Link>
        );
      })}
    </nav>
  );
}

/**
  Every idea as a card: votes, who and when, the title, the start of the
  body, and how many replies. The whole card opens the thread; the vote pill
  sits above that link so a tap on it only votes.
*/
export function IdeaList({ ideas, meId, actorRole }: { ideas: IdeaSummary[]; meId: string; actorRole: "OWNER" | "STAFF" }) {
  const now = new Date(useNow());
  const actor = { id: meId, role: actorRole };

  if (ideas.length === 0) {
    return (
      <div className="rounded-bento border border-dashed border-border px-6 py-12 text-center">
        <Lightbulb className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 font-medium">No ideas yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Got a thought about the menu, the shifts or the shop? Share the first idea.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3" aria-label="Ideas">
      {ideas.map((idea) => (
        <li
          key={idea.id}
          className="relative flex gap-3 rounded-bento border border-border bg-card p-4 shadow-card transition-shadow hover:shadow-float sm:p-5"
        >
          <div className="relative z-10 pt-0.5">
            <VoteButton
              key={`${idea.id}:${idea.upvotes}:${idea.upvotedByMe}`}
              id={idea.id}
              upvotes={idea.upvotes}
              upvotedByMe={idea.upvotedByMe}
              canVote={canVoteIdea(actor, { authorId: idea.author?.id ?? null, deleted: idea.deleted })}
              size="sm"
              className="flex-col gap-0 px-0 py-1 h-auto w-10"
            />
          </div>
          <div className="min-w-0 flex-1">
            <Byline author={idea.author} meId={meId} createdAt={idea.createdAt} editedAt={idea.editedAt} now={now} />
            <h2 className="display mt-1.5 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
              <Link
                href={`/ideas/${idea.id}`}
                className="after:absolute after:inset-0 after:rounded-bento focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                {idea.title}
              </Link>
            </h2>
            {idea.deleted ? (
              <p className="mt-1 text-sm italic text-muted-foreground">{DELETED}</p>
            ) : (
              idea.snippet && (
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{idea.snippet}</p>
              )
            )}
            <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {idea.replyCount === 0 ? "No replies yet" : `${idea.replyCount} ${idea.replyCount === 1 ? "reply" : "replies"}`}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

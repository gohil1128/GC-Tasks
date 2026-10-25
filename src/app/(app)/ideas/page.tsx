import type { Metadata } from "next";
import { IdeaList, SortToggle } from "@/components/ideas/idea-list";
import { ShareIdeaButton } from "@/components/ideas/share-idea-dialog";
import { APP_SHORT_NAME } from "@/lib/brand";
import { requirePageUser } from "@/lib/page-auth";
import { listIdeas } from "@/modules/ideas/queries";
import { isIdeaSort } from "@/modules/ideas/thread";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Ideas · ${APP_SHORT_NAME}` };

/**
  Everyone's ideas and opinions, Top (most upvoted) or New. Open to every
  signed-in account; anything else in ?sort= reads as Top.
*/
export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ sort?: string | string[] }> }) {
  const me = await requirePageUser();
  const { sort: raw } = await searchParams;
  const sort = isIdeaSort(raw) ? raw : "top";

  const ideas = await listIdeas(me.id, sort);
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-semibold">Ideas</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ideas and opinions from the team. Reply, and upvote the good ones.</p>
        </div>
        <ShareIdeaButton />
      </div>
      {ideas.length > 0 && <SortToggle sort={sort} />}
      <IdeaList ideas={ideas} meId={me.id} actorRole={me.role} />
    </div>
  );
}

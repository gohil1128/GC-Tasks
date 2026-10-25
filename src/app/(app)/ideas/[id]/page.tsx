import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IdeaThreadView } from "@/components/ideas/idea-thread";
import { APP_SHORT_NAME } from "@/lib/brand";
import { requirePageUser } from "@/lib/page-auth";
import { getIdeaThread } from "@/modules/ideas/queries";
import { storable } from "@/modules/tasks/validation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
  One read per request, shared by the title and the page. A NUL in the id
  would fail the query itself rather than find nothing, so it finds nothing.
*/
const readThread = cache(async (viewerId: string, id: string) => (storable(id) ? getIdeaThread(viewerId, id) : null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const me = await requirePageUser();
  const { id } = await params;
  const thread = await readThread(me.id, id);
  return { title: `${thread?.idea.title ?? "Idea"} · ${APP_SHORT_NAME}` };
}

/** One idea and its replies. An idea that is gone, or a reply's id, is a 404. */
export default async function IdeaPage({ params }: Props) {
  const me = await requirePageUser();
  const { id } = await params;
  const thread = await readThread(me.id, id);
  if (!thread) notFound();

  return <IdeaThreadView thread={thread} actor={{ id: me.id, role: me.role }} />;
}

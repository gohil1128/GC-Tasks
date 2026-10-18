import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { requirePageUser } from "@/lib/page-auth";
import { canManageTeam } from "@/lib/permissions";
import { listTeam } from "@/modules/team/service";
import { TeamView } from "./_components/team-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Team · ${APP_SHORT_NAME}` };

/** Owners only. Staff never see the link, and arriving by URL just goes back to the board. */
export default async function TeamPage() {
  const me = await requirePageUser();
  if (!canManageTeam(me)) redirect("/");

  const members = await listTeam();
  return <TeamView members={members} meId={me.id} />;
}

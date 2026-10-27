import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { APP_SHORT_NAME } from "@/lib/brand";
import { timeAgo } from "@/lib/dates";
import { requirePageUser } from "@/lib/page-auth";
import { canManageTeam, ROLE_LABEL } from "@/lib/permissions";
import { getMemberProfile, MEMBER_ACTIVITY_LIMIT } from "@/modules/team/activity";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Team · ${APP_SHORT_NAME}` };

/**
  A teammate's profile: who they are and every change they've made on the
  board, newest first. Owners only, like the Team page it opens from.
*/
export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  if (!canManageTeam(me)) redirect("/");

  const { id } = await params;
  const member = await getMemberProfile(id);
  if (!member) notFound();
  const owner = member.role === "OWNER";

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/team"
        className="flex w-fit items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Team
      </Link>

      <div className="flex items-center gap-4">
        <Avatar person={member} size="lg" className={!member.active ? "opacity-50 grayscale" : undefined} />
        <div className="min-w-0">
          <h1 className="display truncate text-2xl font-semibold">{member.name}</h1>
          <p className="truncate text-sm text-muted-foreground">{member.email}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={owner ? "brand" : "secondary"}>
              {owner && <ShieldCheck className="h-3 w-3" aria-hidden />}
              {ROLE_LABEL[member.role]}
            </Badge>
            {!member.active && <Badge variant="muted">Deactivated</Badge>}
          </div>
        </div>
      </div>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Recent changes</h2>
          <p className="text-xs text-muted-foreground">
            {member.totalChanges > MEMBER_ACTIVITY_LIMIT
              ? `Latest ${MEMBER_ACTIVITY_LIMIT} of ${member.totalChanges}`
              : `${member.totalChanges} ${member.totalChanges === 1 ? "change" : "changes"}`}
          </p>
        </div>

        {member.activity.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {member.name} hasn&apos;t changed anything on the board yet.
          </p>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {member.activity.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.taskArchived ? "/" : `/?task=${item.taskId}`}
                  className="block px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  <p className="text-sm">
                    <span className="font-medium">{member.name}</span> {item.text}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.taskTitle}
                    {item.taskArchived && " (archived)"} · <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

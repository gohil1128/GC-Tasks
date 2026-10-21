"use client";
import * as React from "react";
import { ChevronRight, History } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ActivityDTO, BoardMember } from "@/modules/tasks/types";
import { activityLine } from "./task-logic";

const UNKNOWN: BoardMember = { id: "", name: "Someone", color: "slate", avatar: null, role: "STAFF", active: false };

/**
  What has happened to the task, newest first, folded away by default: it is
  there for "who moved this?", not something to read every time.
*/
export function ActivityList({
  activity,
  members,
  currentUserId,
  now,
  loading,
}: {
  activity: ActivityDTO[];
  members: BoardMember[];
  currentUserId: string;
  now: Date;
  loading?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const byId = React.useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  return (
    <section>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="-mx-2 flex items-center gap-2 rounded-full px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          History
          <ChevronRight
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
      </h3>
      <div id={listId} hidden={!open} className="pt-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <span aria-hidden className="pt-0.5">
                  <Avatar person={byId.get(a.actorId) ?? UNKNOWN} size="xs" />
                </span>
                <p className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">
                  {activityLine(a, members, currentUserId)}
                  <span className="text-muted-foreground">
                    {" · "}
                    <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
                      {timeAgo(a.createdAt, now)}
                    </time>
                  </span>
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

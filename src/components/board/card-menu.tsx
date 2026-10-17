"use client";
import * as React from "react";
import {
  Archive,
  ArrowRight,
  Hand,
  LogOut,
  MoreHorizontal,
  PanelRightOpen,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canArchiveOrDelete, canJoinTask, canLeaveTask, canMoveTask } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { STATUSES, STATUS_LABEL, type TaskCard } from "@/modules/tasks/types";
import { useBoard } from "./board-context";

/*
  The card's "…" menu. It lists only what the viewer may actually do — a
  staff member looking at someone else's card sees "Open" and nothing else,
  rather than a row of items that would each be refused.

  "Move to" is how cards change column on a phone, where only one column is
  on screen to drag within.
*/
export function CardMenu({ card, className }: { card: TaskCard; className?: string }) {
  const { actor, actions } = useBoard();
  const canMove = canMoveTask(actor, card);
  const canJoin = canJoinTask(actor, card);
  const canLeave = canLeaveTask(actor, card);
  const canRemove = canArchiveOrDelete(actor);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${card.title}`}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-[opacity,background-color,color]",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // Always there on touch screens, which cannot hover to reveal it.
            "[@media(hover:hover)]:opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:bg-accent data-[state=open]:opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => actions.open(card.id)}>
          <PanelRightOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          Open
        </DropdownMenuItem>

        {canMove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {STATUSES.filter((s) => s !== card.status).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => actions.move(card, s)}>
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                {STATUS_LABEL[s]}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {(canJoin || canLeave) && (
          <>
            <DropdownMenuSeparator />
            {canJoin && (
              <DropdownMenuItem onSelect={() => actions.join(card)}>
                <Hand className="h-4 w-4 text-muted-foreground" aria-hidden />
                I&apos;ll take this
              </DropdownMenuItem>
            )}
            {canLeave && (
              <DropdownMenuItem onSelect={() => actions.leave(card)}>
                <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
                Leave this task
              </DropdownMenuItem>
            )}
          </>
        )}

        {canRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.archive(card)}>
              <Archive className="h-4 w-4 text-muted-foreground" aria-hidden />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => actions.requestDelete(card)}
              className="text-destructive focus:text-destructive data-[highlighted]:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";
import { Ellipsis, KeyRound, ShieldCheck, UserCheck, UserCog, UserX } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABEL } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/modules/team/types";

export type MemberRequest = "promote" | "demote" | "reset" | "deactivate" | "reactivate";

export function MemberRow({
  member,
  isMe,
  busy,
  onRequest,
}: {
  member: TeamMember;
  isMe: boolean;
  busy: boolean;
  onRequest: (request: MemberRequest, member: TeamMember) => void;
}) {
  const owner = member.role === "OWNER";

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card sm:gap-4 sm:p-4",
        !member.active && "bg-muted shadow-none",
      )}
    >
      <Avatar person={member} size="lg" className={cn(!member.active && "opacity-50 grayscale")} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className={cn("truncate font-medium", !member.active && "text-muted-foreground")}>{member.name}</p>
          {isMe && (
            <Badge variant="outline" className="shrink-0 px-2 py-0.5">
              You
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge variant={owner ? "brand" : "secondary"}>
            {owner && <ShieldCheck className="h-3 w-3" aria-hidden />}
            {ROLE_LABEL[member.role]}
          </Badge>
          {member.active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Deactivated</Badge>}
          {member.active && member.mustChangePassword && (
            <Badge variant="warning" title="They're still on a temporary password and will choose their own at next sign-in.">
              <KeyRound className="h-3 w-3" aria-hidden />
              Must set password
            </Badge>
          )}
        </div>
      </div>

      {/* Nothing here for your own row: every one of these is refused for yourself. */}
      {!isMe && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              aria-label={`Manage ${member.name}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Ellipsis className="h-5 w-5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {member.active ? (
              <>
                {owner ? (
                  <DropdownMenuItem onSelect={() => onRequest("demote", member)}>
                    <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Change to staff
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onRequest("promote", member)}>
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Make owner
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onRequest("reset", member)}>
                  <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Reset password
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onRequest("deactivate", member)}
                  className="text-destructive focus:text-destructive"
                >
                  <UserX className="h-4 w-4" aria-hidden />
                  Deactivate
                </DropdownMenuItem>
              </>
            ) : (
              // A deactivated account can do nothing until it is back, so
              // that is the only thing offered; reset after if needed.
              <DropdownMenuItem onSelect={() => onRequest("reactivate", member)}>
                <UserCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
                Reactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

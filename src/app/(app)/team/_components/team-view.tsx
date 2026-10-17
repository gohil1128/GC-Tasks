"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { runAction } from "@/lib/action-client";
import { ROLE_DESCRIPTION } from "@/lib/permissions";
import {
  resetMemberPasswordAction,
  setMemberActiveAction,
  setMemberRoleAction,
} from "@/modules/team/actions";
import type { TeamMember } from "@/modules/team/types";
import { AddMemberDialog, type AddedMember } from "./add-member-dialog";
import { MemberRow, type MemberRequest } from "./member-row";
import { TempPasswordDialog, type Reveal } from "./temp-password-dialog";

type Pending = { request: Exclude<MemberRequest, "promote">; member: TeamMember };

/*
  The list comes from the server and is never copied into state here: after
  each change the page is refreshed and re-read, so what is shown is what the
  database says — including anything another owner did in the meantime.
*/
export function TeamView({ members, meId }: { members: TeamMember[]; meId: string }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [reveal, setReveal] = React.useState<Reveal | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const owners = members.filter((m) => m.role === "OWNER");
  const staff = members.filter((m) => m.role === "STAFF");
  const activeCount = members.filter((m) => m.active).length;

  function onAdded({ member, tempPassword }: AddedMember) {
    setAdding(false);
    setReveal({ kind: "added", name: member.name, email: member.email, password: tempPassword });
    router.refresh();
  }

  async function promote(member: TeamMember) {
    setBusyId(member.id);
    const result = await runAction(setMemberRoleAction(member.id, "OWNER"));
    setBusyId(null);
    if (result.ok) {
      toast.success(`${member.name} is now an owner.`);
      router.refresh();
    }
  }

  function onRequest(request: MemberRequest, member: TeamMember) {
    if (request === "promote") void promote(member);
    else setPending({ request, member });
  }

  /** Runs the confirmed change; false keeps the dialog open after a refusal. */
  async function confirm(): Promise<boolean> {
    if (!pending) return true;
    const { request, member } = pending;
    if (request === "reset") {
      const result = await runAction(resetMemberPasswordAction(member.id));
      if (!result.ok) return false;
      setReveal({ kind: "reset", name: member.name, email: member.email, password: result.data.tempPassword });
      router.refresh();
      return true;
    }
    const result =
      request === "demote"
        ? await runAction(setMemberRoleAction(member.id, "STAFF"))
        : await runAction(setMemberActiveAction(member.id, request === "reactivate"));
    if (!result.ok) return false;
    toast.success(
      request === "demote"
        ? `${member.name} is now staff.`
        : request === "deactivate"
          ? `${member.name} has been deactivated.`
          : `${member.name} can sign in again.`,
    );
    router.refresh();
    return true;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-semibold">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeCount} active · {owners.length} {owners.length === 1 ? "owner" : "owners"}, {staff.length} staff
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" aria-hidden />
          Add teammate
        </Button>
      </div>

      <MemberGroup
        id="owners"
        title="Owners"
        blurb={ROLE_DESCRIPTION.OWNER}
        members={owners}
        meId={meId}
        busyId={busyId}
        onRequest={onRequest}
      />
      <MemberGroup
        id="staff"
        title="Staff"
        blurb={ROLE_DESCRIPTION.STAFF}
        members={staff}
        meId={meId}
        busyId={busyId}
        onRequest={onRequest}
        empty="No staff yet. Add a teammate as Staff to let them work the tasks they're on."
      />

      <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
        Deactivated people can&apos;t sign in and are taken off every task, but their name stays on everything they
        did. Nobody is ever deleted.
      </p>

      <AddMemberDialog open={adding} onOpenChange={setAdding} onAdded={onAdded} />
      <TempPasswordDialog reveal={reveal} onClose={() => setReveal(null)} />
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          {...confirmCopy(pending)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function MemberGroup({
  id,
  title,
  blurb,
  members,
  meId,
  busyId,
  onRequest,
  empty,
}: {
  id: string;
  title: string;
  blurb: string;
  members: TeamMember[];
  meId: string;
  busyId: string | null;
  onRequest: (request: MemberRequest, member: TeamMember) => void;
  empty?: string;
}) {
  if (members.length === 0 && !empty) return null;
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-8">
      <div className="mb-3">
        <h2 id={`${id}-heading`} className="display text-lg font-semibold">
          {title} <span className="text-muted-foreground">· {members.length}</span>
        </h2>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="grid gap-2">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} isMe={m.id === meId} busy={busyId === m.id} onRequest={onRequest} />
          ))}
        </ul>
      )}
    </section>
  );
}

function confirmCopy({ request, member }: Pending): {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
} {
  const first = member.name.split(/\s+/)[0] || member.name;
  switch (request) {
    case "demote":
      return {
        title: `Change ${member.name} to staff?`,
        description: (
          <>
            <p>
              {first} stays on the tasks they&apos;re assigned to, but will no longer be able to create, edit, assign,
              archive or delete tasks, or manage labels and the team.
            </p>
            <p>
              <span className="font-medium text-foreground">Staff</span> — {ROLE_DESCRIPTION.STAFF}
            </p>
          </>
        ),
        confirmLabel: "Change to staff",
        pendingLabel: "Changing…",
      };
    case "reset":
      return {
        title: `Reset ${first}'s password?`,
        description: (
          <>
            <p>
              Their current password stops working straight away, and anywhere they&apos;re signed in will ask for the
              new one.
            </p>
            <p>You&apos;ll get a temporary password to give them; they&apos;ll choose their own when they next sign in.</p>
          </>
        ),
        confirmLabel: "Reset password",
        pendingLabel: "Resetting…",
      };
    case "deactivate":
      return {
        title: `Deactivate ${member.name}?`,
        description: (
          <>
            <p>
              {first} won&apos;t be able to sign in, and will be taken off every task they&apos;re assigned to.
            </p>
            <p>
              Their name stays on the tasks, comments and history they left behind. You can reactivate them later, but
              their assignments won&apos;t come back.
            </p>
          </>
        ),
        confirmLabel: "Deactivate",
        pendingLabel: "Deactivating…",
        destructive: true,
      };
    case "reactivate":
      return {
        title: `Reactivate ${member.name}?`,
        description: (
          <p>
            {first} will be able to sign in again with their existing password and can be assigned to tasks. They
            won&apos;t be put back on the tasks they were taken off.
          </p>
        ),
        confirmLabel: "Reactivate",
        pendingLabel: "Reactivating…",
      };
  }
}

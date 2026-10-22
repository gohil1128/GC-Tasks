"use client";
import * as React from "react";
import { useBackToClose } from "@/components/ui/back-to-close";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/action-client";
import type { Role } from "@/lib/permissions";
import type { Member } from "@/modules/tasks/types";
import { addMemberAction } from "@/modules/team/actions";
import { EMAIL_MAX, NAME_MAX } from "@/modules/team/schemas";
import { RoleChoice } from "./role-choice";

export type AddedMember = { member: Member; tempPassword: string };

export function AddMemberDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (added: AddedMember) => void;
}) {
  useBackToClose(open, () => onOpenChange(false));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a teammate</DialogTitle>
          <DialogDescription>
            You&apos;ll get a temporary password to give them. They choose their own the first time they sign in.
          </DialogDescription>
        </DialogHeader>
        {/* Inside the content so it unmounts on close and the next add starts blank. */}
        <AddMemberForm onCancel={() => onOpenChange(false)} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  );
}

function AddMemberForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (added: AddedMember) => void }) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("STAFF");
  const [pending, setPending] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await runAction(addMemberAction({ name, email, role }));
    setPending(false);
    if (result.ok) onAdded(result.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="member-name">Name</Label>
        <Input
          id="member-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          className="h-11 text-base sm:text-sm"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="member-email">Email</Label>
        <Input
          id="member-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={EMAIL_MAX}
          autoComplete="off"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="member-email-hint"
          className="h-11 text-base sm:text-sm"
        />
        <p id="member-email-hint" className="text-xs text-muted-foreground">
          What they&apos;ll sign in with.
        </p>
      </div>
      <RoleChoice name="member-role" value={role} onChange={setRole} disabled={pending} />
      <DialogFooter className="mt-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Adding…" : "Add teammate"}
        </Button>
      </DialogFooter>
    </form>
  );
}

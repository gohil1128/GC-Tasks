"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAction } from "@/lib/action-client";
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/permissions";
import { updateProfileAction } from "@/modules/team/actions";
import { NAME_MAX } from "@/modules/team/schemas";
import { ColorPicker } from "./color-picker";

export function ProfileForm({
  me,
}: {
  me: { id: string; name: string; email: string; color: string; role: Role };
}) {
  const router = useRouter();
  const [name, setName] = React.useState(me.name);
  const [color, setColor] = React.useState(me.color);
  const [saving, setSaving] = React.useState(false);
  const dirty = name.trim() !== me.name || color !== me.color;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    const result = await runAction(updateProfileAction({ name, color }));
    setSaving(false);
    if (result.ok) {
      setName(result.data.name);
      toast.success("Profile saved.");
      // The header and every card you are on read your name and colour from the server.
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="grid gap-5">
      <div className="flex items-center gap-4">
        <Avatar
          person={{ id: me.id, name: name.trim() || me.name, color }}
          size="lg"
          className="h-14 w-14 text-lg"
        />
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{me.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={me.role === "OWNER" ? "brand" : "secondary"}>{ROLE_LABEL[me.role]}</Badge>
          </div>
        </div>
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">{ROLE_DESCRIPTION[me.role]}</p>

      <div className="grid gap-1.5">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={NAME_MAX}
          autoComplete="name"
          className="h-11 text-base sm:text-sm"
        />
      </div>

      <ColorPicker name="profile-color" legend="Avatar colour" showLegend value={color} onChange={setColor} />

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

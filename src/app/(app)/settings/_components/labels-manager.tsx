"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/shell/confirm-dialog";
import { runAction } from "@/lib/action-client";
import { COLOR_KEYS, tintClass } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "@/modules/labels/actions";
import { NAME_MAX } from "@/modules/team/schemas";
import { ColorPicker, colorName } from "./color-picker";

export type ManagedLabel = { id: string; name: string; color: string; taskCount: number };

/*
  Owners only — the page does not render this for staff, and the label
  actions refuse them anyway.

  Edits are per row and explicit (Save, or Enter): a half-typed rename should
  not land on every card on the board while someone is still deciding.
*/
export function LabelsManager({ labels }: { labels: ManagedLabel[] }) {
  return (
    <div className="grid gap-4">
      {labels.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No labels yet. Add one below — Kitchen, Marketing, Events…
        </p>
      ) : (
        <ul className="grid gap-2" aria-label="Labels">
          {labels.map((label) => (
            // Keyed on content too, so a rename saved here or by another owner
            // resets the row to what the server now says.
            <LabelRow key={`${label.id}:${label.name}:${label.color}`} label={label} />
          ))}
        </ul>
      )}
      <NewLabelForm labels={labels} />
    </div>
  );
}

function ColorButton({
  name,
  value,
  onChange,
  labelName,
}: {
  name: string;
  value: string;
  onChange: (key: string) => void;
  labelName: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Colour for ${labelName || "new label"}: ${colorName(value)}. Change colour`}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent transition-shadow hover:shadow-card",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
            tintClass(value),
          )}
        >
          <Tag className="h-4 w-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[min(18rem,calc(100vw-2rem))] p-3">
        <ColorPicker name={name} legend={`Colour for ${labelName || "new label"}`} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function LabelRow({ label }: { label: ManagedLabel }) {
  const router = useRouter();
  const [name, setName] = React.useState(label.name);
  const [color, setColor] = React.useState(label.color);
  const [saving, setSaving] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const trimmed = name.trim();
  const nameChanged = trimmed !== label.name;
  const colorChanged = color !== label.color;
  const dirty = nameChanged || colorChanged;

  async function save() {
    if (!dirty || saving || !trimmed) return;
    setSaving(true);
    const result = await runAction(
      updateLabelAction({
        id: label.id,
        ...(nameChanged ? { name: trimmed } : {}),
        ...(colorChanged ? { color } : {}),
      }),
    );
    setSaving(false);
    if (result.ok) {
      toast.success(`Saved “${result.data.name}”.`);
      router.refresh();
    }
  }

  function reset() {
    setName(label.name);
    setColor(label.color);
  }

  async function remove(): Promise<boolean> {
    const result = await runAction(deleteLabelAction(label.id));
    if (!result.ok) return false;
    toast.success(`Deleted “${label.name}”.`);
    router.refresh();
    return true;
  }

  const uses = label.taskCount === 1 ? "1 task" : `${label.taskCount} tasks`;

  return (
    <li className="flex items-center gap-2">
      <ColorButton name={`label-color-${label.id}`} value={color} onChange={setColor} labelName={label.name} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape" && dirty) {
            e.preventDefault();
            reset();
          }
        }}
        aria-label={`Name of the ${label.name} label`}
        aria-describedby={`label-uses-${label.id}`}
        maxLength={NAME_MAX}
        className="h-10 min-w-0 flex-1 text-base sm:text-sm"
      />
      <span id={`label-uses-${label.id}`} className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:block">
        {uses}
      </span>
      {dirty ? (
        <Button size="sm" onClick={save} disabled={saving || !trimmed} aria-busy={saving} className="h-10 shrink-0">
          {saving ? "Saving…" : "Save"}
        </Button>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label={`Delete the ${label.name} label`}
          className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete “${label.name}”?`}
        description={
          <p>
            {label.taskCount === 0
              ? "No tasks use it, so nothing else changes."
              : `It comes off the ${uses} that carry it. The tasks themselves stay as they are.`}
          </p>
        }
        confirmLabel="Delete label"
        pendingLabel="Deleting…"
        destructive
        onConfirm={remove}
      />
    </li>
  );
}

/** Suggest a colour nobody is using yet, so a new label stands apart from the rest. */
function freshColor(labels: ManagedLabel[]): string {
  const used = new Set(labels.map((l) => l.color));
  return COLOR_KEYS.find((k) => !used.has(k)) ?? COLOR_KEYS[labels.length % COLOR_KEYS.length];
}

function NewLabelForm({ labels }: { labels: ManagedLabel[] }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(() => freshColor(labels));
  const [saving, setSaving] = React.useState(false);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const result = await runAction(createLabelAction({ name: trimmed, color }));
    setSaving(false);
    if (result.ok) {
      toast.success(`Added “${result.data.name}”.`);
      setName("");
      setColor(freshColor([...labels, { ...result.data, taskCount: 0 }]));
      router.refresh();
    }
  }

  return (
    <form onSubmit={add} className="flex items-center gap-2 border-t border-border pt-4">
      <ColorButton name="new-label-color" value={color} onChange={setColor} labelName={name.trim()} />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New label"
        aria-label="New label name"
        maxLength={NAME_MAX}
        className="h-10 min-w-0 flex-1 text-base sm:text-sm"
      />
      <Button type="submit" size="sm" disabled={!name.trim() || saving} aria-busy={saving} className="h-10 shrink-0">
        <Plus className="h-4 w-4" aria-hidden />
        {saving ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}

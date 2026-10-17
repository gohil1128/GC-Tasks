"use client";
import { ArrowDown, ArrowUp, Flame, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITIES, PRIORITY_LABEL, type Priority } from "@/modules/tasks/types";
import { NativeSelect } from "./field";

const ICON: Record<Priority, typeof Flame> = { LOW: ArrowDown, MEDIUM: Minus, HIGH: ArrowUp, URGENT: Flame };

const TONE: Record<Priority, string> = {
  LOW: "text-muted-foreground",
  MEDIUM: "text-muted-foreground",
  HIGH: "text-brand-ink",
  URGENT: "text-destructive",
};

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = ICON[priority];
  return <Icon aria-hidden className={cn("h-3.5 w-3.5", TONE[priority], className)} />;
}

/** Low / Medium / High / Urgent. Read-only shows the same words without a control. */
export function PrioritySelect({
  id,
  value,
  onChange,
  readOnly,
}: {
  id?: string;
  value: Priority;
  onChange: (priority: Priority) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <p id={id} className="flex min-h-10 items-center gap-2 px-2 text-sm">
        <PriorityIcon priority={value} />
        <span className={cn(value === "URGENT" && "font-semibold text-destructive")}>{PRIORITY_LABEL[value]}</span>
      </p>
    );
  }
  return (
    <NativeSelect
      id={id}
      value={value}
      leading={<PriorityIcon priority={value} />}
      onChange={(e) => onChange(e.target.value as Priority)}
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABEL[p]}
        </option>
      ))}
    </NativeSelect>
  );
}

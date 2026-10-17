"use client";
import { cn } from "@/lib/utils";
import { STATUSES, STATUS_LABEL, type Status } from "@/modules/tasks/types";
import { NativeSelect } from "./field";

const STATUS_DOT: Record<Status, string> = {
  TODO: "bg-muted-foreground",
  IN_PROGRESS: "bg-brand",
  DONE: "bg-success",
};

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", STATUS_DOT[status], className)} />;
}

/** Which column a task is in. Changing it moves the card to the top of that column. */
export function StatusSelect({
  id,
  value,
  onChange,
  disabled,
  variant = "field",
  label,
  title,
}: {
  id?: string;
  value: Status;
  onChange: (status: Status) => void;
  disabled?: boolean;
  variant?: "field" | "pill";
  /** An accessible name when no <label> points at the control. */
  label?: string;
  /** Shown on hover when disabled, to say why. */
  title?: string;
}) {
  return (
    <NativeSelect
      id={id}
      variant={variant}
      value={value}
      disabled={disabled}
      aria-label={label}
      title={title}
      leading={<StatusDot status={value} />}
      onChange={(e) => onChange(e.target.value as Status)}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </NativeSelect>
  );
}

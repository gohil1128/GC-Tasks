"use client";
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// Staff first: it is the default, and the choice most people will want.
const ORDER: Role[] = ["STAFF", "OWNER"];

/** Owner or Staff, each with what it means underneath — a native radio group, so arrow keys work. */
export function RoleChoice({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">Role</legend>
      {ORDER.map((role) => {
        const id = `${name}-${role}`;
        return (
          <label
            key={role}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-accent/60",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              value === role && "border-brand-strong bg-brand-muted hover:bg-brand-muted",
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={role}
              checked={value === role}
              onChange={() => onChange(role)}
              aria-describedby={`${id}-desc`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--brand-strong))] focus-visible:outline-none"
            />
            <span className="grid gap-0.5">
              <span className="text-sm font-semibold">{ROLE_LABEL[role]}</span>
              <span id={`${id}-desc`} className="text-xs leading-relaxed text-muted-foreground">
                {ROLE_DESCRIPTION[role]}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

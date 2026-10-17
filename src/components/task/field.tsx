"use client";
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  The small pieces both task dialogs build their fields from. Selects are the
  browser's own: on a phone that means the system picker, which is easier to
  hit with a thumb than any popover, and it comes with keyboard and screen
  reader support for free.
*/

export const FIELD_LABEL_CLASS = "text-2xs font-semibold uppercase tracking-wide text-muted-foreground";

/** A field's caption. A real <label> when it names a form control, a span (for aria-labelledby) when it names a group. */
export function FieldLabel({
  htmlFor,
  id,
  children,
  className,
}: {
  htmlFor?: string;
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} id={id} className={cn(FIELD_LABEL_CLASS, className)}>
        {children}
      </label>
    );
  }
  return (
    <span id={id} className={cn(FIELD_LABEL_CLASS, className)}>
      {children}
    </span>
  );
}

export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** "field" fills its column like an input; "pill" is the compact rounded chip used in a header. */
  variant?: "field" | "pill";
  /** Drawn inside the control, before the text (a status dot, a priority icon). */
  leading?: React.ReactNode;
};

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, variant = "field", leading, children, ...props }, ref) => (
    <div className={cn("relative flex items-center", variant === "field" ? "w-full" : "inline-flex", className)}>
      {leading && (
        <span aria-hidden className="pointer-events-none absolute left-3 flex items-center">
          {leading}
        </span>
      )}
      <select
        ref={ref}
        className={cn(
          "w-full cursor-pointer appearance-none border border-input bg-card pr-8 text-sm transition-colors",
          "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card",
          variant === "field" ? "h-10 rounded-xl" : "h-8 rounded-full font-medium",
          leading ? "pl-8" : "pl-3",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground"
      />
    </div>
  ),
);
NativeSelect.displayName = "NativeSelect";

/** The surface a click-to-change field sits on: quiet until hovered or focused. */
export const PICKER_TRIGGER_CLASS = cn(
  "flex min-h-10 w-full items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 text-left text-sm transition-colors",
  "hover:border-border hover:bg-accent/50 data-[state=open]:border-border data-[state=open]:bg-accent/50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

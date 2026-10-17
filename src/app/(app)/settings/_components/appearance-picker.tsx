"use client";
import { useTheme } from "next-themes";
import { THEME_OPTIONS } from "@/components/shell/theme-options";
import { useMounted } from "@/components/shell/use-mounted";
import { cn } from "@/lib/utils";

/** Light, Dark or System. Stored per device by next-themes, so a phone and a laptop can differ. */
export function AppearancePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (theme ?? "system") : null;

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map(({ value, label, hint, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-border bg-card px-2 py-3 text-center transition-colors hover:bg-accent/60",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              current === value && "border-brand-strong bg-brand-muted hover:bg-brand-muted",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={current === value}
              onChange={() => setTheme(value)}
              className="sr-only"
            />
            <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium">{label}</span>
            <span className="hidden text-2xs text-muted-foreground sm:block">{hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

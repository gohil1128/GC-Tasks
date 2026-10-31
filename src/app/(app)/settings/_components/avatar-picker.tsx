"use client";
import { Check } from "lucide-react";
import { AVATAR_KEYS, AVATAR_LABEL, type AvatarKey } from "@/lib/avatars";
import { solidClass } from "@/lib/colors";
import { ChaiArt } from "@/components/ui/chai-art";
import { cn } from "@/lib/utils";

/**
  The chai set as a native radio group, the same pattern as the colour
  picker: arrow keys move, Space picks, a screen reader hears each one's
  name. Each option is drawn on your own colour, so what you pick is exactly
  what the board shows.
*/
export function AvatarPicker({
  name,
  value,
  color,
  onChange,
}: {
  /** Unique per picker on the page — it is the radio group's name. */
  name: string;
  value: AvatarKey;
  /** The colour picked above, so the options preview as they will look. */
  color: string;
  onChange: (key: AvatarKey) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Avatar</legend>
      <div className="flex flex-wrap gap-2">
        {AVATAR_KEYS.map((key) => {
          const checked = value === key;
          return (
            <label key={key} className="relative cursor-pointer" title={AVATAR_LABEL[key]}>
              <input
                type="radio"
                name={name}
                value={key}
                checked={checked}
                onChange={() => onChange(key)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ring-offset-2 ring-offset-card transition-shadow",
                  solidClass(color),
                  "peer-checked:ring-2 peer-checked:ring-foreground/70",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-ring",
                )}
              >
                <ChaiArt avatar={key} className="absolute inset-0 h-full w-full" />
                {checked && (
                  <span className="absolute right-0 bottom-0 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </span>
              <span className="sr-only">{AVATAR_LABEL[key]}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Your chai shows on every card, comment and notification, on your colour.
      </p>
    </fieldset>
  );
}

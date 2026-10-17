"use client";
import { Check } from "lucide-react";
import { COLOR_KEYS, solidClass } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function colorName(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
  The palette as a native radio group: arrow keys move between swatches, Space
  picks one, and a screen reader hears each colour's name.
*/
export function ColorPicker({
  name,
  legend,
  value,
  onChange,
  showLegend = false,
}: {
  /** Unique per picker on the page — it is the radio group's name. */
  name: string;
  legend: string;
  value: string;
  onChange: (key: string) => void;
  showLegend?: boolean;
}) {
  return (
    <fieldset>
      <legend className={showLegend ? "mb-2 text-sm font-medium" : "sr-only"}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {COLOR_KEYS.map((key) => {
          const checked = value === key;
          return (
            <label key={key} className="relative cursor-pointer" title={colorName(key)}>
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
                  "flex h-9 w-9 items-center justify-center rounded-full ring-offset-2 ring-offset-card transition-shadow",
                  "peer-checked:ring-2 peer-checked:ring-foreground/70",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-ring",
                  solidClass(key),
                )}
              >
                {checked && <Check className="h-4 w-4" />}
              </span>
              <span className="sr-only">{colorName(key)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

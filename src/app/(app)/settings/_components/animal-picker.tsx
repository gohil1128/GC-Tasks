"use client";
import { Check } from "lucide-react";
import { ANIMAL_LABEL, CUTE_ANIMALS, WILD_ANIMALS, type AnimalKey } from "@/lib/avatars";
import { AnimalArt } from "@/components/ui/animal-art";
import { cn } from "@/lib/utils";

/**
  The chai club as a native radio group, the same pattern as the colour
  picker: arrow keys move, Space picks, a screen reader hears each animal's
  name. Two crews — cute and wild — under their own sub-headings,
  each option the actual artwork on a soft disc so what you pick is exactly
  what the board shows (minus your colour behind it there).
*/
export function AnimalPicker({
  name,
  value,
  onChange,
}: {
  /** Unique per picker on the page — it is the radio group's name. */
  name: string;
  value: AnimalKey;
  onChange: (key: AnimalKey) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Avatar animal</legend>
      <Crew name={name} legend="Cute crew" animals={CUTE_ANIMALS} value={value} onChange={onChange} />
      <div className="mt-3">
        <Crew name={name} legend="Wild crew" animals={WILD_ANIMALS} value={value} onChange={onChange} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Your animal shows on every card, comment and notification with your colour behind it.
      </p>
    </fieldset>
  );
}

function Crew({
  name,
  legend,
  animals,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  animals: readonly AnimalKey[];
  value: AnimalKey;
  onChange: (key: AnimalKey) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{legend}</p>
      <div className="flex flex-wrap gap-2">
        {animals.map((key) => {
          const checked = value === key;
          return (
            <label key={key} className="relative cursor-pointer" title={ANIMAL_LABEL[key]}>
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
                  "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-secondary ring-offset-2 ring-offset-card transition-shadow",
                  "peer-checked:ring-2 peer-checked:ring-foreground/70",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-ring",
                )}
              >
                <AnimalArt animal={key} className="absolute inset-0 h-full w-full" />
                {checked && (
                  <span className="absolute right-0 bottom-0 flex h-4 w-4 items-center justify-center rounded-full bg-foreground text-background">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </span>
              <span className="sr-only">{ANIMAL_LABEL[key]}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

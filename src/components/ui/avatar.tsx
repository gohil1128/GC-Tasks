import { animalFor } from "@/lib/avatars";
import { solidClass } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { AnimalArt } from "./animal-art";

export type AvatarPerson = { id: string; name: string; color: string; avatar?: string | null };

const SIZES = {
  xs: "h-5 w-5",
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
  A person as their animal from the chai club (src/lib/avatars.ts): the pick
  they made in Settings, or the one seeded from their account id when they
  have not picked yet. The animal is drawn full-bleed over the person's
  colour, which rings it and tints the corners — colour plus species is
  what tells people apart at card size, where the old single kulhad glyph
  in twelve tints could not. The name stays in the tooltip and the
  screen-reader text.
*/
export function Avatar({
  person,
  size = "sm",
  className,
}: {
  person: AvatarPerson;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      title={person.name}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-2 ring-card",
        solidClass(person.color),
        SIZES[size],
        className,
      )}
    >
      <AnimalArt animal={animalFor(person)} className="absolute inset-0 h-full w-full" />
      <span className="sr-only">{person.name}</span>
    </span>
  );
}

const COUNT_SIZES = {
  xs: "text-[9px]",
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
} as const;

/** Overlapping avatars, collapsing past `max` into a "+N". */
export function AvatarStack({
  people,
  max = 3,
  size = "sm",
}: {
  people: AvatarPerson[];
  max?: number;
  size?: AvatarSize;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex -space-x-1.5" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-beige-deep font-semibold text-foreground ring-2 ring-card",
            SIZES[size],
            COUNT_SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

import { cn, initials } from "@/lib/utils";
import { solidClass } from "@/lib/colors";

export type AvatarPerson = { id: string; name: string; color: string };

const SIZES = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export function Avatar({
  person,
  size = "sm",
  className,
}: {
  person: AvatarPerson;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      title={person.name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-2 ring-card",
        solidClass(person.color),
        SIZES[size],
        className,
      )}
    >
      {initials(person.name)}
      <span className="sr-only">{person.name}</span>
    </span>
  );
}

/** Overlapping avatars, collapsing past `max` into a "+N". */
export function AvatarStack({
  people,
  max = 3,
  size = "sm",
}: {
  people: AvatarPerson[];
  max?: number;
  size?: keyof typeof SIZES;
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
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

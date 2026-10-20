import { cn } from "@/lib/utils";
import { solidClass } from "@/lib/colors";

export type AvatarPerson = { id: string; name: string; color: string };

const SIZES = {
  xs: "h-5 w-5",
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
} as const;

const GLYPH_SIZES = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
  lg: "h-6 w-6",
} as const;

/**
 * A little kullhad (clay chai cup) with steam curls, drawn in the avatar's
 * foreground colour. The cup stays the same for everyone; the badge's solid
 * colour is still what tells people apart.
 */
function ChaiCupGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* steam curls */}
      <path d="M9.6 7.8c-1.2-1.4 1.2-2.2 0-3.6" />
      <path d="M14.4 7.8c-1.2-1.4 1.2-2.2 0-3.6" />
      {/* kullhad body: wide mouth, tapered, rounded base */}
      <path d="M6 10.4h12l-1.1 7.5a2.6 2.6 0 0 1-2.6 2.3H9.7a2.6 2.6 0 0 1-2.6-2.3L6 10.4Z" />
      {/* chai surface */}
      <path d="M9 14.1h6" />
    </svg>
  );
}

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
        "inline-flex shrink-0 select-none items-center justify-center rounded-full ring-2 ring-card",
        solidClass(person.color),
        SIZES[size],
        className,
      )}
    >
      <ChaiCupGlyph className={GLYPH_SIZES[size]} />
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
            COUNT_SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

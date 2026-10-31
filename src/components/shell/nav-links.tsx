"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lightbulb, Settings, SquareKanban, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; ownersOnly?: boolean };

const ITEMS: NavItem[] = [
  { href: "/", label: "Board", icon: SquareKanban },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  { href: "/team", label: "Team", icon: Users, ownersOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
  Team is left out for staff entirely rather than shown and refused: the page
  would only send them back to the board.

  From `sm` up the places sit in the header, named. On a phone they live in
  the TabBar at the bottom instead, so the header carries only the logo, the
  bell and your account.
*/
export function NavLinks({ canManageTeam }: { canManageTeam: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.ownersOnly || canManageTeam);

  return (
    <nav aria-label="Main" className="hidden min-w-0 sm:block">
      <ul className="flex items-center gap-0.5 sm:gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={label}
                className={cn(
                  "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors sm:px-3",
                  "hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active && "bg-card text-foreground shadow-card hover:bg-card",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
  The phone's tab bar (Apple HIG, tab-bars.md): the app's places at the
  bottom, where a thumb reaches them, each an icon over a one-word label,
  always on screen — a sheet slides over it, as a modal should. Places, never
  actions: New task and the like stay with the page they act on.

  The current tab is told apart by colour, weight and a filled pill behind
  its icon, not by colour alone. Each tab is the full height of the bar and
  an equal share of its width — 49pt or more, like the system's.
*/
export function TabBar({ canManageTeam }: { canManageTeam: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.ownersOnly || canManageTeam);

  return (
    <nav
      aria-label="Main"
      className="shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
    >
      <ul className="flex">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[52px] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-2xs font-medium text-muted-foreground transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  "active:text-foreground",
                  active && "font-semibold text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-muted text-brand-ink",
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.25 : 1.75} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

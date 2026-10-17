"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, SquareKanban, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; ownersOnly?: boolean };

const ITEMS: NavItem[] = [
  { href: "/", label: "Board", icon: SquareKanban },
  { href: "/team", label: "Team", icon: Users, ownersOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
  Team is left out for staff entirely rather than shown and refused: the page
  would only send them back to the board.
*/
export function NavLinks({ canManageTeam }: { canManageTeam: boolean }) {
  const pathname = usePathname();
  const items = ITEMS.filter((item) => !item.ownersOnly || canManageTeam);

  return (
    <nav aria-label="Main" className="min-w-0">
      <ul className="flex items-center gap-0.5 sm:gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active && "bg-card text-foreground shadow-card hover:bg-card",
                )}
              >
                <Icon className="hidden h-4 w-4 sm:block" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

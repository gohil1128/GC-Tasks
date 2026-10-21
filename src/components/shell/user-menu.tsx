"use client";
import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, KeyRound, LogOut, Settings } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_DESCRIPTION, ROLE_LABEL, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/modules/auth/actions";
import { THEME_OPTIONS } from "@/components/shell/theme-options";
import { useMounted } from "@/components/shell/use-mounted";

export type ShellUser = { id: string; name: string; email: string; color: string; avatar: string | null; role: Role };

const itemClass =
  "relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent";

export function UserMenu({ me }: { me: ShellUser }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [signingOut, startSignOut] = React.useTransition();
  const staff = me.role === "STAFF";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${me.name}, ${ROLE_LABEL[me.role]}`}
          className={cn(
            "flex h-10 items-center gap-2 rounded-full p-1 transition-colors hover:bg-accent md:pr-3",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <Avatar person={me} size="md" />
          <span className="hidden max-w-[11rem] truncate text-sm font-medium md:block">{me.name}</span>
          <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-2rem))]">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar person={me} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold">{me.name}</p>
              <Badge variant={staff ? "secondary" : "brand"} className="shrink-0 px-2 py-0.5">
                {ROLE_LABEL[me.role]}
              </Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{me.email}</p>
          </div>
        </div>

        {staff && (
          // Staff meet hidden buttons all over the board; this says why, once,
          // somewhere they will find it without it nagging.
          <p className="mx-1.5 mb-1.5 rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Staff access.</span> {ROLE_DESCRIPTION.STAFF} For
            anything else, ask an owner.
          </p>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mounted ? (theme ?? "system") : ""} onValueChange={setTheme}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuPrimitive.RadioItem
              key={value}
              value={value}
              className={itemClass}
              // Stay open, so the change can be seen before choosing to leave.
              onSelect={(e) => e.preventDefault()}
            >
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
              {label}
              <DropdownMenuPrimitive.ItemIndicator className="ml-auto">
                <Check className="h-4 w-4 text-brand-ink" aria-hidden />
              </DropdownMenuPrimitive.ItemIndicator>
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
            Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={() => startSignOut(() => signOutAction())}
        >
          <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

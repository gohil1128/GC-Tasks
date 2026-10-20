import Link from "next/link";
import { APP_SHORT_NAME } from "@/lib/brand";
import { canManageTeam } from "@/lib/permissions";
import { BrandLogo } from "@/components/shell/brand-logo";
import { NavLinks } from "@/components/shell/nav-links";
import { NotificationBell } from "@/components/shell/notification-bell";
import { UserMenu, type ShellUser } from "@/components/shell/user-menu";

/*
  One slim row: logo, the three places there are to go, and the account menu.
  It has to fit a 360px phone with the board below it, so the app name and
  the nav icons only appear once there is room for them.
*/
export function AppHeader({ me }: { me: ShellUser }) {
  return (
    <header className="shrink-0 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-4 sm:px-5">
        <Link
          href="/"
          aria-label={`${APP_SHORT_NAME} — the board`}
          className="flex shrink-0 items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <BrandLogo imgClassName="h-8" decorative />
          <span className="display hidden text-lg font-semibold leading-none sm:inline">{APP_SHORT_NAME}</span>
        </Link>
        <NavLinks canManageTeam={canManageTeam(me)} />
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell />
          <UserMenu me={me} />
        </div>
      </div>
    </header>
  );
}

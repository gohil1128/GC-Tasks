import { requirePageUser } from "@/lib/page-auth";
import { AppHeader } from "@/components/shell/app-header";

export const dynamic = "force-dynamic";

/*
  Everything behind sign-in. The middleware only knows a session cookie
  exists; this asks the database, so a deactivated account is turned away on
  its next page load rather than when its cookie expires — and someone still
  on a temporary password gets no further than choosing their own.

  The frame is exactly the viewport tall, header then main, and main takes the
  rest (flex-1 min-h-0) so the board can lay its columns out in that height and
  scroll each one on its own. Taller pages, like Team and Settings, scroll
  inside main.
*/
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePageUser();

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-espresso px-4 py-2 text-sm font-medium text-espresso-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <AppHeader me={{ id: me.id, name: me.name, email: me.email, color: me.color, avatar: me.avatar, role: me.role }} />
      <main id="main" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

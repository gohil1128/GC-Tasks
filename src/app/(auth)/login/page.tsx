import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";
import { safeNextPath } from "@/modules/auth/safe-next";
import { hasAnyUser } from "@/modules/auth/setup";
import { BrandLogo } from "@/components/shell/brand-logo";
import { LoginForm } from "../_components/login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Sign in · ${APP_SHORT_NAME}` };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  // A brand-new deployment has nobody to sign in as yet.
  if (!(await hasAnyUser())) redirect("/setup");

  const params = await searchParams;
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next);

  const me = await currentUser();
  if (me) redirect(me.mustChangePassword ? "/change-password" : next);

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand panel. The ink-* steps are the logo browns and are the same in
          both themes, so this stays espresso when the rest of the page goes dark. */}
      <div
        className={[
          "relative m-3 hidden overflow-hidden rounded-bento p-10 lg:m-5 lg:flex lg:flex-col lg:justify-between",
          "bg-[radial-gradient(120%_120%_at_0%_100%,hsl(var(--ink-600))_0%,hsl(var(--ink-800))_50%,hsl(var(--ink-950))_100%)]",
          "text-[hsl(var(--rust-100))]",
        ].join(" ")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute -bottom-16 -right-16 h-[420px] w-auto opacity-[0.07] brightness-[4]"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt={APP_NAME} className="h-16 w-auto self-start brightness-[3.4] saturate-[.4]" />

        <div className="relative">
          <p className="display text-[44px] font-medium leading-[1.05]">
            What&apos;s brewing
            <br />
            today.
          </p>
          <p className="mt-3.5 max-w-[360px] text-sm leading-relaxed opacity-75">
            The God&apos;s Chai team board — who&apos;s on what, what&apos;s next, and what&apos;s done.
          </p>
        </div>

        <div className="relative text-2xs opacity-60">{APP_NAME}</div>
      </div>

      <main className="flex items-center justify-center px-4 py-10 sm:p-10">
        <div className="w-full max-w-[380px]">
          {/* On small screens the brand panel is hidden, so the logo shows here. */}
          <BrandLogo className="mb-6 lg:hidden" imgClassName="h-14" />
          <h1 className="display text-[30px] font-semibold leading-tight">Welcome back</h1>
          <p className="mb-7 mt-1.5 text-sm text-muted-foreground">Sign in to the team board.</p>
          <LoginForm next={next} />
          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Forgotten your password? Ask an owner to reset it for you from the Team page.
          </p>
        </div>
      </main>
    </div>
  );
}

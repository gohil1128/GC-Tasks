import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";
import { passwordResetEnabled } from "@/modules/auth/password-reset";
import { safeNextPath } from "@/modules/auth/safe-next";
import { hasAnyUser } from "@/modules/auth/setup";
import { signupsAvailable } from "@/modules/auth/signup";
import { LoginFloat } from "@/components/shell/login-float";
import { LoginVideo } from "@/components/shell/login-video";
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

  const canSignUp = await signupsAvailable();

  return (
    <div className="login-scene">
      {/* Chai simmering, full screen, under an espresso scrim so the cream type stays readable. */}
      <div aria-hidden className="login-stage">
        <LoginVideo className="login-video" />
        <div className="login-scrim" />
      </div>
      <p aria-hidden className="display login-tagline">
        What&apos;s brewing
        <br />
        today.
      </p>

      <main className="login-main">
        <LoginFloat>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={APP_NAME} className="login-logo" />
          <h1 className="display text-[30px] font-semibold leading-tight">Welcome back</h1>
          <p className="mb-7 mt-1.5 text-sm text-muted-foreground">Sign in to the team board.</p>
          <LoginForm next={next} />
          {/* Only with email sending set up: otherwise there is no way to deliver a code. */}
          {passwordResetEnabled() ? (
            <p className="mt-6 text-center text-sm">
              <Link
                href="/forgot-password"
                className="rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Forgot password?
              </Link>
            </p>
          ) : (
            <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
              Forgotten your password? Ask an owner to reset it for you from the Team page.
            </p>
          )}
          {/* Needs email sending too, and an owner can close it from the Team page. */}
          {canSignUp && (
            <p className="mt-3 text-center text-sm text-muted-foreground">
              New to the team?{" "}
              <Link
                href="/signup"
                className="rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Create an account
              </Link>
            </p>
          )}
        </LoginFloat>
      </main>
      <p aria-hidden className="login-foot">
        {APP_NAME}
      </p>
    </div>
  );
}

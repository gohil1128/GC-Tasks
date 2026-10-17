import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { APP_SHORT_NAME } from "@/lib/brand";
import { signOutAction } from "@/modules/auth/actions";
import { AuthCard } from "../_components/auth-card";
import { ChangePasswordForm } from "../_components/change-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Change password · ${APP_SHORT_NAME}` };

/*
  Two arrivals, one page: somebody the app sent here because they are still on
  a password an owner chose for them — for whom this is the only page that
  loads — and somebody who simply wants to change theirs. The copy and the way
  out differ; the form does not.
*/
export default async function ChangePasswordPage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/change-password");

  const forced = me.mustChangePassword;
  const linkClass = "rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <AuthCard
      title={forced ? "Choose your password" : "Change your password"}
      description={
        forced ? (
          <>
            Welcome, {me.name}. You&apos;re signed in with a temporary password someone else set for you. Pick your
            own to carry on — after this, only you will know it.
          </>
        ) : (
          <>Signed in as {me.email}.</>
        )
      }
      footer={
        <div className="flex items-center justify-center gap-4">
          {!forced && (
            <Link href="/" className={linkClass}>
              Back to the board
            </Link>
          )}
          <form action={signOutAction}>
            <button type="submit" className={linkClass}>
              {forced ? "Not you? Sign out" : "Sign out"}
            </button>
          </form>
        </div>
      }
    >
      <ChangePasswordForm forced={forced} email={me.email} />
    </AuthCard>
  );
}

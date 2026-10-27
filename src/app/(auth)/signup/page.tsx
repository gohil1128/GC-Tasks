import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { APP_SHORT_NAME } from "@/lib/brand";
import { signupsAvailable } from "@/modules/auth/signup";
import { AuthCard } from "../_components/auth-card";
import { SignupForm } from "../_components/signup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Create an account · ${APP_SHORT_NAME}`, robots: { index: false } };

const linkClass =
  "rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* No page at all unless email sending is configured and an owner has sign-ups open. */
export default async function SignupPage() {
  if (!(await signupsAvailable())) notFound();
  // Already signed in: nothing to sign up for.
  if (await currentUser()) redirect("/");

  return (
    <AuthCard
      title="Create an account"
      description="Join the God's Chai team board as staff. We'll email you a 6‑digit code to confirm your address."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={linkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}

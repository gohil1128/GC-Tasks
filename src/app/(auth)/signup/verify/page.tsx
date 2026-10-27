import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { signupSentMessage, signupsAvailable } from "@/modules/auth/signup";
import { EMAIL_MAX } from "@/modules/team/schemas";
import { AuthCard } from "../../_components/auth-card";
import { SignupCodeForm } from "../../_components/signup-code-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Check your email · ${APP_SHORT_NAME}`, robots: { index: false } };

const linkClass =
  "rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Params = { email?: string | string[]; sent?: string | string[] };

export default async function VerifySignupPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(await signupsAvailable())) notFound();

  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  // Only a prefill; the action checks whatever is submitted.
  const email = first(params.email).slice(0, EMAIL_MAX);
  const sent = first(params.sent) === "1" && email !== "";

  return (
    <AuthCard
      title="Check your email"
      description={sent ? signupSentMessage(email) : "Enter the 6-digit code from the email to finish creating your account."}
      footer={
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/signup" className={linkClass}>
            Didn&apos;t get it? Start again
          </Link>
          <Link href="/login" className={linkClass}>
            Back to sign in
          </Link>
        </div>
      }
    >
      <SignupCodeForm email={email} />
    </AuthCard>
  );
}

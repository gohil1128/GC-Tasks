import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { GENERIC_SENT_MESSAGE, passwordResetEnabled } from "@/modules/auth/password-reset";
import { AuthCard } from "../../_components/auth-card";
import { ResetCodeForm } from "../../_components/reset-code-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Enter your code · ${APP_SHORT_NAME}`, robots: { index: false } };

const linkClass =
  "rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Params = { email?: string | string[]; sent?: string | string[] };

export default async function VerifyResetCodePage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!passwordResetEnabled()) notFound();

  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  // Only a prefill; the action checks whatever is submitted.
  const email = first(params.email).slice(0, 254);
  const sent = first(params.sent) === "1";

  return (
    <AuthCard
      title="Enter your code"
      description={sent ? GENERIC_SENT_MESSAGE : "Enter the 6-digit code from the email and choose a new password."}
      footer={
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Link href="/forgot-password" className={linkClass}>
            Didn&apos;t get it? Send a new code
          </Link>
          <Link href="/login" className={linkClass}>
            Back to sign in
          </Link>
        </div>
      }
    >
      <ResetCodeForm email={email} />
    </AuthCard>
  );
}

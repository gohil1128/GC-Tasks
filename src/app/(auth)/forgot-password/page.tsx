import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { passwordResetEnabled } from "@/modules/auth/password-reset";
import { AuthCard } from "../_components/auth-card";
import { ForgotPasswordForm } from "../_components/forgot-password-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Forgot password · ${APP_SHORT_NAME}`, robots: { index: false } };

const linkClass =
  "rounded text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* Without email sending configured there is no way to deliver a code, so no page either. */
export default function ForgotPasswordPage() {
  if (!passwordResetEnabled()) notFound();

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the email you sign in with. We'll email you a 6‑digit code to choose a new password."
      footer={
        <Link href="/login" className={linkClass}>
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}

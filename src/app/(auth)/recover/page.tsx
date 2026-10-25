import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { recoveryEnabled } from "@/modules/auth/recovery";
import { AuthCard } from "../_components/auth-card";
import { RecoverForm } from "../_components/recover-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Recover an account · ${APP_SHORT_NAME}`, robots: { index: false } };

/*
  Not linked from anywhere: whoever needs it was told about it when they set
  RECOVERY_KEY. Without the variable the page does not exist.
*/
export default function RecoverPage() {
  if (!recoveryEnabled()) notFound();

  return (
    <AuthCard
      title="Recover an account"
      description="Enter the recovery key from the hosting settings and choose a new password for the account. Everything on the account stays as it is."
    >
      <RecoverForm />
    </AuthCard>
  );
}

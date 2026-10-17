import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { APP_SHORT_NAME } from "@/lib/brand";
import { hasAnyUser } from "@/modules/auth/setup";
import { AuthCard } from "../_components/auth-card";
import { SetupForm } from "../_components/setup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Set up · ${APP_SHORT_NAME}` };

/*
  First run only. Once anybody has an account this page just sends people to
  sign in — and setupAction checks again inside its transaction, because a
  page that rendered a moment ago proves nothing about now.
*/
export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return (
    <AuthCard
      title="Set up the board"
      description={
        <>
          Nobody has an account yet, so you&apos;re first. This creates the owner account — you&apos;ll add
          everyone else from the Team page once you&apos;re in.
        </>
      }
    >
      <SetupForm />
    </AuthCard>
  );
}

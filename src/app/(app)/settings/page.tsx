import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_SHORT_NAME } from "@/lib/brand";
import { requirePageUser } from "@/lib/page-auth";
import { canManageLabels } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { AppearancePicker } from "./_components/appearance-picker";
import { LabelsManager, type ManagedLabel } from "./_components/labels-manager";
import { ProfileForm } from "./_components/profile-form";
import { SettingsSection } from "./_components/section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Settings · ${APP_SHORT_NAME}` };

async function readLabels(): Promise<ManagedLabel[]> {
  const rows = await prisma.label.findMany({
    select: { id: true, name: true, color: true, _count: { select: { tasks: true } } },
  });
  // Sorted here rather than by the database, whose collation may put "admin" after "Zebra".
  return rows
    .map((r) => ({ id: r.id, name: r.name, color: r.color, taskCount: r._count.tasks }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export default async function SettingsPage() {
  const me = await requirePageUser();
  const managesLabels = canManageLabels(me);
  const labels = managesLabels ? await readLabels() : [];

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="display text-3xl font-semibold">Settings</h1>

      <SettingsSection id="profile" title="Profile" description="How you appear on cards, comments and the team list.">
        <ProfileForm me={{ id: me.id, name: me.name, email: me.email, color: me.color, avatar: me.avatar, role: me.role }} />
      </SettingsSection>

      <SettingsSection id="password" title="Password" description={`You sign in as ${me.email}.`}>
        <Button asChild variant="outline">
          <Link href="/change-password">
            <KeyRound className="h-4 w-4" aria-hidden />
            Change password
          </Link>
        </Button>
      </SettingsSection>

      <SettingsSection id="appearance" title="Appearance" description="Saved on this device.">
        <AppearancePicker />
      </SettingsSection>

      {managesLabels && (
        <SettingsSection
          id="labels"
          title="Labels"
          description="The tags tasks can carry. Renaming or recolouring one changes it on every task that has it."
        >
          <LabelsManager labels={labels} />
        </SettingsSection>
      )}
    </div>
  );
}

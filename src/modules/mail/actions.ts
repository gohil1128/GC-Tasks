"use server";
import { revalidatePath } from "next/cache";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { isOwner } from "@/lib/permissions";
import { MailConfigError } from "@/modules/mail/crypto";
import { disconnectMailbox, scanNow } from "@/modules/mail/service";
import type { ScanResult } from "@/modules/mail/pipeline";
import { readRevision } from "@/modules/tasks/revision";
import { sessionFailure } from "@/modules/team/service";
import type { ActionResult } from "@/modules/tasks/types";

/* Owners only, checked here on the server; Settings only shows them to owners. */

async function asOwner<T>(work: (me: CurrentUser) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let me: CurrentUser;
  try {
    me = await requireUser();
  } catch (err) {
    return sessionFailure(err);
  }
  if (!isOwner(me)) return { ok: false, code: "FORBIDDEN", error: "Only owners can manage the mailbox." };
  return work(me);
}

export async function scanNowAction(): Promise<ActionResult<ScanResult>> {
  return asOwner(async (me) => {
    try {
      const result = await scanNow(me);
      revalidatePath("/settings");
      revalidatePath("/");
      return { ok: true, data: result, revision: await readRevision() };
    } catch (e) {
      if (e instanceof MailConfigError) return { ok: false, code: "INVALID", error: e.message };
      throw e;
    }
  });
}

export async function disconnectMailboxAction(): Promise<ActionResult<{ done: true }>> {
  return asOwner(async (me) => {
    await disconnectMailbox(me);
    revalidatePath("/settings");
    return { ok: true, data: { done: true }, revision: await readRevision() };
  });
}

"use server";
import { headers } from "next/headers";
import { after } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  cancelEmailChange,
  confirmEmailChange,
  requestEmailChange,
  type ConfirmEmailChangeResult,
  type RequestEmailChangeResult,
} from "@/modules/auth/email-change";
import { clientIpFrom } from "@/modules/auth/rate-limit";

/*
  The Settings form's two steps for changing your own email. Results come
  back as values, never thrown: a production build strips a thrown message.
*/

const signedOut = { ok: false, code: "INVALID", error: "You've been signed out. Sign in again." } as const;

export async function requestEmailChangeAction(input: {
  newEmail: string;
  password: string;
}): Promise<RequestEmailChangeResult> {
  const me = await currentUser();
  if (!me) return signedOut;
  return requestEmailChange(me.id, input, clientIpFrom(await headers()));
}

export async function confirmEmailChangeAction(input: { code: string }): Promise<ConfirmEmailChangeResult> {
  const me = await currentUser();
  if (!me) return signedOut;
  return confirmEmailChange(me.id, input, clientIpFrom(await headers()), { defer: (work) => after(work) });
}

export async function cancelEmailChangeAction(): Promise<void> {
  const me = await currentUser();
  if (me) await cancelEmailChange(me.id);
}

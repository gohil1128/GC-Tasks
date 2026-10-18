"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser, signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordSchema, verifyPassword } from "@/modules/auth/password";
import {
  checkLoginAllowed,
  clearLoginFailures,
  clientIpFrom,
  loginKeys,
  reserveLoginAttempt,
} from "@/modules/auth/rate-limit";
import { safeNextPath } from "@/modules/auth/safe-next";
import { createFirstOwner } from "@/modules/auth/setup";

/*
  The signed-out side of the app: sign in, first-run setup, choosing your own
  password, and signing out.

  These back plain <form action> forms, so failures come back as { error }
  rather than being thrown: Next.js strips the message off a thrown Error in a
  production build, and "That isn't your current password" would reach the
  browser as an unreadable digest. Success redirects, which is also how a form
  without JavaScript ends up in the right place.
*/

export type AuthFormState = { error?: string; values?: Record<string, string> } | null;

function waitText(sec: number): string {
  const mins = Math.ceil(sec / 60);
  return mins <= 1 ? "a minute" : `${mins} minutes`;
}

function tooMany(sec: number | null): string {
  return `Too many attempts. Try again in ${sec === null ? "a few minutes" : waitText(sec)}.`;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

// ── Sign in ───────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Enter your email address.").email("Enter a valid email address."),
  // Not passwordSchema: sign-in must not lock out a password that predates the rule.
  password: z.string().min(1, "Enter your password."),
});

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = { email: field(formData, "email") };
  const parsed = loginSchema.safeParse({ email: values.email, password: field(formData, "password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", values };
  const { email, password } = parsed.data;

  // Read the lock here too, so the form can say how long to wait instead of
  // repeating "wrong password" at someone who is already locked out.
  const keys = loginKeys(email, clientIpFrom(await headers()));
  const before = await checkLoginAllowed(keys);
  if (before.locked) return { error: tooMany(before.retryAfterSec), values };

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    // The lock may have come with this very attempt — authorize() counts it
    // before checking the password — or from a parallel one since the check above.
    const after = await checkLoginAllowed(keys);
    if (after.locked) return { error: tooMany(after.retryAfterSec), values };
    if (err instanceof Error && /LOGIN_LOCKED/.test(err.message)) return { error: tooMany(null), values };
    return { error: "That email and password don't match an account.", values };
  }

  /*
    Read straight from the row rather than the session: the cookie signIn just
    set is not visible to auth() within this same request.
  */
  const account = await prisma.user.findUnique({ where: { email }, select: { mustChangePassword: true } });
  redirect(account?.mustChangePassword ? "/change-password" : safeNextPath(field(formData, "next")));
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

// ── First run ─────────────────────────────────────────────────────────────

export async function setupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const values = { name: field(formData, "name"), email: field(formData, "email") };
  const result = await createFirstOwner({
    ...values,
    password: field(formData, "password"),
    confirmPassword: field(formData, "confirmPassword"),
  });
  if (!result.ok) {
    // Somebody else finished setting up first; this form has nothing left to do.
    if (result.code === "FORBIDDEN") redirect("/login");
    return { error: result.error, values };
  }

  try {
    await signIn("credentials", {
      email: result.data.email,
      password: field(formData, "password"),
      redirect: false,
    });
  } catch {
    // The account exists either way; signing in by hand is the way through.
    redirect("/login");
  }
  redirect("/");
}

// ── Your own password ─────────────────────────────────────────────────────

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "The two new passwords don't match.",
    path: ["confirmPassword"],
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "That's the password you already have. Pick a different one.",
    path: ["newPassword"],
  });

/*
  For anyone signed in — including, and especially, someone still on a
  temporary password, who cannot pass requireUser() until this succeeds. So
  this checks the session with currentUser() instead.

  The current password proves it is the account holder at the keyboard and not
  a borrowed session, and a guess counts toward the same lockout as a sign-in,
  taken the same way before the check, or this form would be a way round it.

  A new password signs out every session issued before it, this one included
  (see currentUser), so this one is issued again straight away.
*/
export async function changePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const me = await currentUser();
  if (!me) redirect("/login?next=/change-password");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: field(formData, "currentPassword"),
    newPassword: field(formData, "newPassword"),
    confirmPassword: field(formData, "confirmPassword"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };

  const keys = loginKeys(me.email, clientIpFrom(await headers()));
  const slot = await reserveLoginAttempt(keys);
  if (slot.locked) return { error: tooMany(slot.retryAfterSec) };

  const row = await prisma.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!row) redirect("/login");

  if (!(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
    const after = await checkLoginAllowed(keys);
    if (after.locked) return { error: tooMany(after.retryAfterSec) };
    return { error: "That isn't your current password." };
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  await clearLoginFailures(keys);

  try {
    await signIn("credentials", { email: me.email, password: parsed.data.newPassword, redirect: false });
  } catch {
    // The new password is set either way; signing in with it is the way through.
    redirect("/login");
  }
  redirect("/");
}

import { cache } from "react";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";
import { verifyPassword } from "@/modules/auth/password";
import {
  clearLoginFailures,
  clientIpFrom,
  LoginLockedError,
  loginKeys,
  reserveLoginAttempt,
} from "@/modules/auth/rate-limit";

// A bcrypt hash of a value nobody can supply, compared against when the
// address is unknown so a miss costs the same time as a wrong password.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    sessionVersion: number;
  }
  interface User {
    sessionVersion?: number;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  /*
    A wrong password, or a sign-in refused by the lockout, is the system
    working — not a server error. Auth.js logs both as errors with a stack
    trace, which buried real problems in the log under every mistyped
    password. Everything else still goes to console.error.
  */
  logger: {
    error(error) {
      const type = (error as { type?: string }).type;
      if (type === "CredentialsSignin") return;
      const cause = (error as { cause?: { err?: unknown } }).cause;
      if (type === "CallbackRouteError" && cause?.err instanceof LoginLockedError) return;
      console.error(error);
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const ip = request ? clientIpFrom(new Headers(request.headers)) : null;
        const keys = loginKeys(email, ip);

        const state = await reserveLoginAttempt(keys);
        if (state.locked) throw new LoginLockedError(state.retryAfterSec);

        const user = await prisma.user.findUnique({ where: { email } });
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);

        // A deactivated account fails exactly like a wrong password, and
        // stays counted as one, so the form cannot be used to learn who was
        // removed.
        if (!user || !ok || !user.active) return null;

        await clearLoginFailures(keys);
        return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
      },
    }),
  ],
});

/*
  The signed-in person, read from the database on every request rather than
  trusted out of the token. A JWT is only rewritten at sign-in, so without
  this an owner who deactivates someone would not take effect until that
  person signed out. cache() makes it one query per request.

  The same goes for a password reset or change: the token's sessionVersion
  has to match the account's, so a session issued before one — a lost phone,
  or whoever had the old password — stops working, rather than coming back
  the moment the person picks a new password.
*/
export const currentUser = cache(async () => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      color: true,
      avatar: true,
      role: true,
      active: true,
      mustChangePassword: true,
      sessionVersion: true,
    },
  });
  if (!user || !user.active) return null;
  const { sessionVersion, ...me } = user;
  if (session.sessionVersion !== sessionVersion) return null;
  return me;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
  The gate for every Server Action and route handler. A Server Action can be
  called by anyone who can shape the request, so this check inside it is the
  only one that counts — hiding a button protects nothing.

  An account still on a password somebody else chose may only change it.
*/
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  return user;
}

/** requireUser, and an owner. Staff get "FORBIDDEN". */
export async function requireOwner(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "OWNER") throw new Error("FORBIDDEN");
  return user;
}

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Signing in, the lockout and signing out old sessions, against a real
  Postgres — the lockout is a race between parallel requests, which only the
  database can settle.

  Auth.js itself is swapped for a thin stand-in that keeps the config the app
  hands it: authorize() and the jwt/session callbacks are the app's own, run
  in the order Auth.js runs them, and `shell.session` plays the cookie.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const shell = vi.hoisted(() => {
  class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  /** Stands in for next-auth's: the action tells a refused sign-in from a server fault by it. */
  class CredentialsSignin extends Error {}
  type Config = {
    providers: { authorize: (raw: unknown, request: Request) => Promise<unknown> }[];
    callbacks: {
      jwt: (params: { token: Record<string, unknown>; user?: unknown }) => Promise<Record<string, unknown>>;
      session: (params: { session: unknown; token: Record<string, unknown> }) => Promise<unknown>;
    };
  };
  const state = {
    config: undefined as unknown as Config,
    session: null as unknown,
    ip: "203.0.113.9",
    RedirectSignal,
    CredentialsSignin,
    /** What a credentials sign-in leaves in the cookie, or null when refused. */
    async signInAs(email: string, password: string) {
      const request = new Request("http://localhost/api/auth/callback/credentials", {
        method: "POST",
        headers: { "x-forwarded-for": state.ip },
      });
      const user = (await state.config.providers[0]!.authorize({ email, password }, request)) as { id: string } | null;
      if (!user) return null;
      const issued = await state.config.callbacks.jwt({ token: { sub: user.id }, user });
      // Every request after sign-in runs the callback again, without a user.
      const token = await state.config.callbacks.jwt({ token: issued });
      return state.config.callbacks.session({ session: { user: {}, expires: "" }, token });
    },
  };
  return state;
});

vi.mock("next-auth", () => ({
  CredentialsSignin: shell.CredentialsSignin,
  default: (config: typeof shell.config) => {
    shell.config = config;
    return {
      handlers: {},
      auth: async () => shell.session,
      signIn: async (_provider: string, creds: { email: string; password: string }) => {
        const session = await shell.signInAs(creds.email, creds.password);
        if (!session) throw new shell.CredentialsSignin();
        shell.session = session;
      },
      signOut: async () => {
        shell.session = null;
      },
    };
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: object) => ({ id: "credentials", type: "credentials", ...options }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": shell.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new shell.RedirectSignal(url);
  },
}));
// Counts the bcrypt comparisons, which is what the lockout exists to ration.
vi.mock("@/modules/auth/password", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/auth/password")>();
  return { ...original, verifyPassword: vi.fn(original.verifyPassword) };
});

import { prisma } from "@/lib/prisma";
import type { Actor, Role } from "@/lib/permissions";
import { currentUser } from "@/lib/auth";
import { requirePageUser } from "@/lib/page-auth";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { changePasswordAction, loginAction } from "@/modules/auth/actions";
import { EMAIL_MAX, IP_MAX, LoginLockedError, reserveLoginAttempt } from "@/modules/auth/rate-limit";
import { resetMemberPassword } from "@/modules/team/service";
import TeamPage from "@/app/(app)/team/page";
import SettingsPage from "@/app/(app)/settings/page";

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

const PASSWORD = "correct horse battery";
const checks = vi.mocked(verifyPassword);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
  shell.session = null;
  shell.ip = "203.0.113.9";
  checks.mockClear();
}

let seq = 0;
async function makeUser(role: Role, over: { mustChangePassword?: boolean } = {}) {
  seq += 1;
  const row = await prisma.user.create({
    data: {
      email: `${role.toLowerCase()}${seq}@example.com`,
      name: `${role === "OWNER" ? "Owner" : "Staff"} ${seq}`,
      role,
      mustChangePassword: over.mustChangePassword ?? false,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return { ...row, actor: { id: row.id, role: row.role } as Actor };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

/** Where a Server Action or page redirected to, or what it returned. */
async function outcome<T>(run: () => Promise<T>): Promise<{ redirect: string } | { value: T }> {
  try {
    return { value: await run() };
  } catch (err) {
    if (err instanceof shell.RedirectSignal) return { redirect: err.url };
    throw err;
  }
}

async function asSession<T>(session: unknown, run: () => Promise<T>): Promise<T> {
  shell.session = session;
  return run();
}

async function attempt(key: string) {
  return prisma.loginAttempt.findUnique({ where: { key } });
}

/** Moves a key's clock on, as waiting would: the row's times go back instead. */
async function wait(key: string, ms: number) {
  const interval = `${ms} milliseconds`;
  await prisma.$executeRaw`
    UPDATE "LoginAttempt"
    SET "updatedAt" = "updatedAt" - ${interval}::interval,
        "lockedUntil" = "lockedUntil" - ${interval}::interval
    WHERE "key" = ${key}`;
}

const MINUTE = 60 * 1000;

describe.skipIf(!enabled)("auth (integration)", () => {
  beforeEach(reset);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("a new password signs out every session issued before it", () => {
    it("keeps a lost phone out after a reset, even once the person picks a new password", async () => {
      const owner = await makeUser("OWNER");
      const staff = await makeUser("STAFF");

      const phone = await shell.signInAs(staff.email, PASSWORD);
      expect(await asSession(phone, currentUser)).toMatchObject({ id: staff.id });

      const reset = await resetMemberPassword(owner.actor, staff.id);
      expect(reset.ok).toBe(true);
      if (!reset.ok) return;
      expect(await asSession(phone, currentUser)).toBeNull();

      // On a new device, with the temporary password, then choosing their own.
      const laptop = await shell.signInAs(staff.email, reset.data.tempPassword);
      expect(await asSession(laptop, currentUser)).toMatchObject({ id: staff.id, mustChangePassword: true });
      const changed = await outcome(() =>
        changePasswordAction(
          null,
          form({
            currentPassword: reset.data.tempPassword,
            newPassword: "a brand new password",
            confirmPassword: "a brand new password",
          }),
        ),
      );
      expect(changed).toEqual({ redirect: "/" });

      // The action re-issued the laptop's session; it carries on.
      expect(shell.session).not.toBe(laptop);
      expect(await currentUser()).toMatchObject({ id: staff.id, mustChangePassword: false });
      expect(await asSession(phone, currentUser)).toBeNull();
      expect(await asSession(laptop, currentUser)).toBeNull();
    });

    it("signs out your other sessions when you change your own password, and keeps you signed in", async () => {
      const staff = await makeUser("STAFF");
      const phone = await shell.signInAs(staff.email, PASSWORD);
      const laptop = await shell.signInAs(staff.email, PASSWORD);

      const changed = await asSession(laptop, () =>
        outcome(() =>
          changePasswordAction(
            null,
            form({ currentPassword: PASSWORD, newPassword: "leaked so changed", confirmPassword: "leaked so changed" }),
          ),
        ),
      );
      expect(changed).toEqual({ redirect: "/" });
      expect(await currentUser()).toMatchObject({ id: staff.id });
      expect(await asSession(phone, currentUser)).toBeNull();
      expect(await shell.signInAs(staff.email, PASSWORD)).toBeNull();
      expect(await shell.signInAs(staff.email, "leaked so changed")).not.toBeNull();
    });

    it("keeps a session from before versions existed until the version first moves", async () => {
      const staff = await makeUser("STAFF");
      // A cookie minted before the deploy: an id and nothing else.
      const old = await shell.config.callbacks.session({ session: { user: {}, expires: "" }, token: { id: staff.id } });
      expect(await asSession(old, currentUser)).toMatchObject({ id: staff.id });

      await prisma.user.update({ where: { id: staff.id }, data: { sessionVersion: { increment: 1 } } });
      expect(await asSession(old, currentUser)).toBeNull();
    });
  });

  describe("sign-in lockout", () => {
    it("lets at most EMAIL_MAX of twenty parallel guesses at one account reach the password check", async () => {
      const staff = await makeUser("STAFF");
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => shell.signInAs(staff.email, "not the password")),
      );

      expect(checks).toHaveBeenCalledTimes(EMAIL_MAX);
      expect(results.filter((r) => r.status === "fulfilled" && r.value === null)).toHaveLength(EMAIL_MAX);
      const refused = results.filter((r) => r.status === "rejected");
      expect(refused).toHaveLength(20 - EMAIL_MAX);
      for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LoginLockedError);

      const row = await attempt(`email:${staff.email}`);
      expect(row?.failures).toBe(EMAIL_MAX);
      expect(row?.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * MINUTE);
      // Refused attempts cost nothing: the address was charged only for the checks it got.
      expect((await attempt(`ip:${shell.ip}`))?.failures).toBe(EMAIL_MAX);

      // The right password is refused too, until the lock ends.
      await expect(shell.signInAs(staff.email, PASSWORD)).rejects.toBeInstanceOf(LoginLockedError);
      expect(checks).toHaveBeenCalledTimes(EMAIL_MAX);
    });

    it("counts every one of twenty parallel failures, none lost to another's write", async () => {
      const emails = Array.from({ length: 20 }, (_, i) => `nobody${i}@example.com`);
      await Promise.all(emails.map((email) => shell.signInAs(email, "guess")));

      expect(checks).toHaveBeenCalledTimes(20);
      const row = await attempt(`ip:${shell.ip}`);
      expect(row?.failures).toBe(20);
      expect(IP_MAX).toBe(20);
      expect(row?.lockedUntil).not.toBeNull();
      await expect(shell.signInAs("nobody99@example.com", "guess")).rejects.toBeInstanceOf(LoginLockedError);
      expect(checks).toHaveBeenCalledTimes(20);
    });

    it("does not charge the account for an attempt the address lock refused", async () => {
      await prisma.loginAttempt.create({
        data: { key: `ip:${shell.ip}`, failures: IP_MAX, lockedUntil: new Date(Date.now() + 10 * MINUTE) },
      });
      const state = await reserveLoginAttempt(["email:someone@example.com", `ip:${shell.ip}`]);
      expect(state.locked).toBe(true);
      if (state.locked) expect(state.retryAfterSec).toBeGreaterThan(9 * 60);
      expect(await attempt("email:someone@example.com")).toBeNull();
    });

    it("clears the count on the right password", async () => {
      const staff = await makeUser("STAFF");
      for (let i = 0; i < EMAIL_MAX - 1; i++) expect(await shell.signInAs(staff.email, "nope")).toBeNull();
      expect(await shell.signInAs(staff.email, PASSWORD)).not.toBeNull();
      expect(await attempt(`email:${staff.email}`)).toBeNull();
    });

    it("escalates to the hour-long lock when the failures carry on after a lock", async () => {
      const staff = await makeUser("STAFF");
      const key = `email:${staff.email}`;
      for (let i = 0; i < EMAIL_MAX; i++) expect(await shell.signInAs(staff.email, "nope")).toBeNull();
      let row = await attempt(key);
      expect(row?.failures).toBe(EMAIL_MAX);

      for (let n = EMAIL_MAX + 1; n <= EMAIL_MAX * 2; n++) {
        // Wait the lock out, to the second.
        await wait(key, row!.lockedUntil!.getTime() - Date.now() + 1000);
        expect(await shell.signInAs(staff.email, "nope")).toBeNull();
        row = await attempt(key);
        expect(row?.failures).toBe(n);
      }
      const lockMs = row!.lockedUntil!.getTime() - Date.now();
      expect(lockMs).toBeGreaterThan(59 * MINUTE);
      expect(lockMs).toBeLessThanOrEqual(60 * MINUTE);
      expect(checks).toHaveBeenCalledTimes(EMAIL_MAX * 2);
    });

    it("still forgives failures once the window has passed since the last one, or since its lock ended", async () => {
      const staff = await makeUser("STAFF");
      const key = `email:${staff.email}`;
      for (let i = 0; i < EMAIL_MAX - 1; i++) await shell.signInAs(staff.email, "nope");
      await wait(key, 15 * MINUTE + 1000);
      await shell.signInAs(staff.email, "nope");
      expect((await attempt(key))?.failures).toBe(1);

      await prisma.loginAttempt.update({
        where: { key },
        data: { failures: EMAIL_MAX, lockedUntil: new Date(Date.now() + 15 * MINUTE) },
      });
      await wait(key, 30 * MINUTE + 1000);
      await shell.signInAs(staff.email, "nope");
      expect(await attempt(key)).toMatchObject({ failures: 1, lockedUntil: null });
    });

    it("keeps the sign-in form's messages", async () => {
      const staff = await makeUser("STAFF");
      const tryIt = () => loginAction(null, form({ email: staff.email, password: "nope" }));
      for (let i = 0; i < EMAIL_MAX - 1; i++) {
        expect(await tryIt()).toMatchObject({ error: "That email and password don't match an account." });
      }
      expect(await tryIt()).toMatchObject({ error: "Too many attempts. Try again in 15 minutes." });
      expect(await tryIt()).toMatchObject({ error: "Too many attempts. Try again in 15 minutes." });
      expect(checks).toHaveBeenCalledTimes(EMAIL_MAX);
    });

    it("says a server fault is a server fault, not a wrong password", async () => {
      const staff = await makeUser("STAFF");
      checks.mockRejectedValueOnce(new Error("database unreachable"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await loginAction(null, form({ email: staff.email, password: PASSWORD }))).toMatchObject({
        error: "Couldn't sign you in because of a problem on our side. Try again in a minute.",
      });
      expect(quiet).toHaveBeenCalled();
      quiet.mockRestore();
    });

    it("rations wrong current passwords on Change password the same way, even in parallel", async () => {
      const staff = await makeUser("STAFF");
      const session = await shell.signInAs(staff.email, PASSWORD);
      checks.mockClear();
      shell.session = session;

      const wrong = form({ currentPassword: "a guess", newPassword: "another password", confirmPassword: "another password" });
      const results = await Promise.all(Array.from({ length: 20 }, () => changePasswordAction(null, wrong)));
      expect(checks).toHaveBeenCalledTimes(EMAIL_MAX);
      // Which of the checked ones see the lock in time to say so depends on timing.
      const wrongs = results.filter((r) => r?.error === "That isn't your current password.").length;
      const locked = results.filter((r) => r?.error?.startsWith("Too many attempts.")).length;
      expect(wrongs + locked).toBe(20);
      expect(locked).toBeGreaterThanOrEqual(20 - EMAIL_MAX);

      const right = form({ currentPassword: PASSWORD, newPassword: "another password", confirmPassword: "another password" });
      expect(await changePasswordAction(null, right)).toMatchObject({ error: "Too many attempts. Try again in 15 minutes." });
      expect(await verifyPassword(PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).passwordHash)).toBe(true);
    });
  });

  describe("pages under (app)", () => {
    it("send someone on a temporary password to choose one before reading anything", async () => {
      const owner = await makeUser("OWNER", { mustChangePassword: true });
      await prisma.label.create({ data: { name: "Kitchen", color: "amber" } });
      const session = await shell.signInAs(owner.email, PASSWORD);
      const listTeam = vi.spyOn(prisma.user, "findMany");
      const readLabels = vi.spyOn(prisma.label, "findMany");

      expect(await asSession(session, () => outcome(requirePageUser))).toEqual({ redirect: "/change-password" });
      expect(await outcome(TeamPage)).toEqual({ redirect: "/change-password" });
      expect(await outcome(SettingsPage)).toEqual({ redirect: "/change-password" });
      expect(listTeam).not.toHaveBeenCalled();
      expect(readLabels).not.toHaveBeenCalled();
      // The spies do see the reads, when there are any.
      await prisma.label.findMany();
      expect(readLabels).toHaveBeenCalledTimes(1);
      listTeam.mockRestore();
      readLabels.mockRestore();
    });

    it("send someone signed out, or on an old session, to sign in", async () => {
      const owner = await makeUser("OWNER");
      const session = await shell.signInAs(owner.email, PASSWORD);
      expect(await asSession(null, () => outcome(TeamPage))).toEqual({ redirect: "/login" });

      expect(await asSession(session, () => outcome(requirePageUser))).toMatchObject({ value: { id: owner.id } });
      await prisma.user.update({ where: { id: owner.id }, data: { sessionVersion: { increment: 1 } } });
      expect(await outcome(SettingsPage)).toEqual({ redirect: "/login" });
    });
  });
});

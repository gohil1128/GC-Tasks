import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Self sign-up by emailed code, against a real Postgres: the same answer
  for every address, the "you already have an account" note, the code's
  rules and the limiter, the account it makes and the owners it tells, the
  owners' switch, and the races.

  The sender and web-push are mocked, so nothing here touches the network.
  Next's after() is replaced by a queue the tests flush, so the deferred
  work can be watched happening after the answer. The pages are called as
  plain functions to check the link and the 404s.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const signals = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  class RedirectSignal extends Error {
    constructor(public url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return { NotFoundSignal, RedirectSignal, afterQueue: [] as (() => Promise<void>)[] };
});

vi.mock("@/modules/email/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/email/send")>();
  return { ...original, sendEmail: vi.fn(async () => {}) };
});
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({})) } }));
vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>();
  return { ...original, after: (task: () => Promise<void>) => void signals.afterQueue.push(task) };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77" }) }));
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
vi.mock("@/lib/auth", () => ({ currentUser: async () => null, signIn: vi.fn(async () => {}), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new signals.NotFoundSignal();
  },
  redirect: (url: string) => {
    throw new signals.RedirectSignal(url);
  },
}));

import type { ReactNode } from "react";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/lib/auth";
import { colorForSeed } from "@/lib/colors";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { EMAIL_MAX, IP_MAX } from "@/modules/auth/rate-limit";
import { CODE_MAX_ATTEMPTS, WRONG_CODE_MESSAGE } from "@/modules/auth/email-code";
import { completeSignupAction, requestSignupAction } from "@/modules/auth/actions";
import { issueSigninTicket, userForTicket } from "@/modules/auth/signin-ticket";
import {
  completeSignup,
  EMAIL_TAKEN_MESSAGE,
  requestSignup,
  signupKeys,
  signupsAvailable,
} from "@/modules/auth/signup";
import { sendEmail, type OutgoingEmail } from "@/modules/email/send";
import { getNotificationFeed } from "@/modules/notifications/queries";
import { readRevision } from "@/modules/tasks/revision";
import { readSignupsOpen, setSignupsOpen } from "@/modules/team/service";
import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";
import VerifySignupPage from "@/app/(auth)/signup/verify/page";

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

const EMAIL = "newbie@example.com";
const PASSWORD = "my-chosen-pass-1";
const sent = vi.mocked(sendEmail);
const pushed = vi.mocked(webpush.sendNotification);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "SignupRequest", "BoardSetting", "TeamEvent", "PushSubscription", "PasswordResetCode", "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
  sent.mockReset();
  sent.mockImplementation(async () => {});
  pushed.mockClear();
  vi.mocked(signIn).mockClear();
  signals.afterQueue.length = 0;
}

async function makeUser(over: { email?: string; name?: string; role?: "OWNER" | "STAFF"; active?: boolean } = {}) {
  const email = over.email ?? "owner@example.com";
  return prisma.user.create({
    data: {
      email,
      name: over.name ?? "Owner",
      role: over.role ?? "OWNER",
      passwordHash: await hashPassword("existing-pass-123"),
      color: colorForSeed(email),
      active: over.active ?? true,
    },
  });
}

const form = (over: Partial<Record<"name" | "email" | "password" | "confirmPassword", string>> = {}) => ({
  name: "Asha Patel",
  email: EMAIL,
  password: PASSWORD,
  confirmPassword: PASSWORD,
  ...over,
});

const verify = (code: string, email = EMAIL) => ({ email, code });

function lastEmail(n = -1): OutgoingEmail {
  const call = sent.mock.calls.at(n);
  if (!call) throw new Error("no email was sent");
  return call[0] as OutgoingEmail;
}

function codeFromEmail(n = -1): string {
  const match = /\b(\d{6})\b/.exec(lastEmail(n).text);
  if (!match) throw new Error("no code in the email");
  return match[1]!;
}

const otherThan = (code: string) => (code === "000000" ? "111111" : "000000");

async function flushAfter() {
  while (signals.afterQueue.length) await signals.afterQueue.shift()!();
}

function formData(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string | { error?: string } | null> {
  try {
    return (await run()) as { error?: string } | null;
  } catch (err) {
    if (err instanceof signals.RedirectSignal) return err.url;
    throw err;
  }
}

function hrefs(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(hrefs);
  const props = (node as { props?: Record<string, unknown> }).props ?? {};
  const own = typeof props.href === "string" ? [props.href] : [];
  return [...own, ...hrefs(props.children as ReactNode)];
}

async function pageOutcome(run: () => unknown): Promise<"404" | "rendered"> {
  try {
    await run();
    return "rendered";
  } catch (err) {
    if (err instanceof signals.NotFoundSignal) return "404";
    throw err;
  }
}

const loginPage = () => LoginPage({ searchParams: Promise.resolve({}) });
const verifyPage = () => VerifySignupPage({ searchParams: Promise.resolve({ email: EMAIL, sent: "1" }) });

describe.skipIf(!enabled)("self sign-up by email (integration)", () => {
  beforeEach(async () => {
    await reset();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "GC Tasks <tasks@example.com>");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "test-public-key");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:test@example.com");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  // ── Step 1 ──────────────────────────────────────────────────────────────

  it("emails a new address one 6-digit code and keeps only hashes", async () => {
    await makeUser();
    expect(await requestSignup(form({ email: " NewBie@Example.com " }), "203.0.113.5")).toEqual({
      ok: true,
      email: EMAIL,
    });

    expect(sent).toHaveBeenCalledTimes(1);
    const email = lastEmail();
    const code = codeFromEmail();
    expect(email.to).toBe(EMAIL);
    expect(email.subject).toBe(`Your GC Tasks code: ${code}`);
    expect(email.text).toContain("10 minutes");
    expect(email.html).toContain(code);

    const rows = await prisma.signupRequest.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ email: EMAIL, name: "Asha Patel", attempts: 0 });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, row.passwordHash)).toBe(true);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    // No account until the code comes back.
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0);
    for (const spy of [console.warn, console.error]) {
      for (const args of vi.mocked(spy).mock.calls) expect(JSON.stringify(args)).not.toContain(code);
    }
  });

  it("sends a registered address, active or not, a note instead, and stores nothing", async () => {
    await makeUser();
    await makeUser({ email: "staff@example.com", role: "STAFF" });
    await makeUser({ email: "gone@example.com", role: "STAFF", active: false });

    for (const email of ["staff@example.com", "GONE@example.com"]) {
      expect(await requestSignup(form({ email }), null)).toEqual({ ok: true, email: email.toLowerCase() });
      const note = lastEmail();
      expect(note.to).toBe(email.toLowerCase());
      expect(note.text).toContain(
        "Someone tried to create a GC Tasks account with this email. You already have one: sign in, or use Forgot password on the sign-in page.",
      );
      expect(note.text).not.toMatch(/\b\d{6}\b/);
    }
    expect(sent).toHaveBeenCalledTimes(2);
    expect(await prisma.signupRequest.count()).toBe(0);
    // Nobody's account was touched.
    expect(await prisma.user.count()).toBe(3);
  });

  it("answers the same either way, and does every lookup and send after the response", async () => {
    await makeUser({ email: "staff@example.com", role: "STAFF" });
    const answers: unknown[] = [];
    for (const email of [EMAIL, "staff@example.com"]) {
      const deferred: (() => Promise<void>)[] = [];
      const result = await requestSignup(form({ email }), null, { defer: (work) => void deferred.push(work) });
      answers.push({ ...result, email: "<address>" });
      // Exactly one piece of work either way, and nothing done before it runs.
      expect(deferred).toHaveLength(1);
      expect(sent).not.toHaveBeenCalled();
      expect(await prisma.signupRequest.count({ where: { email } })).toBe(0);
      await deferred[0]!();
      expect(sent).toHaveBeenCalledTimes(1);
      sent.mockClear();
    }
    expect(answers[0]).toEqual(answers[1]);

    // Through the action too: both go on to the same code page.
    const page = (email: string) =>
      redirectOf(() => requestSignupAction(null, formData({ ...form({ email }) })));
    expect(await page(EMAIL)).toBe(`/signup/verify?email=${encodeURIComponent(EMAIL)}&sent=1`);
    expect(await page("staff@example.com")).toBe(
      `/signup/verify?email=${encodeURIComponent("staff@example.com")}&sent=1`,
    );
    expect(signals.afterQueue).toHaveLength(2);
    await flushAfter();
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("checks the form before anything is counted or sent", async () => {
    expect(await requestSignup(form({ name: "  " }), null)).toMatchObject({ code: "INVALID", error: "Enter a name." });
    expect(await requestSignup(form({ email: "not-an-email" }), null)).toMatchObject({ code: "INVALID" });
    expect(await requestSignup(form({ password: "short", confirmPassword: "short" }), null)).toMatchObject({
      code: "INVALID",
    });
    expect(await requestSignup(form({ confirmPassword: "something-else-1" }), null)).toMatchObject({
      code: "INVALID",
      error: "The two passwords don't match.",
    });
    expect(sent).not.toHaveBeenCalled();
    expect(await prisma.loginAttempt.count()).toBe(0);
  });

  it("still gives the same answer when the email cannot be sent, and logs without the code", async () => {
    sent.mockRejectedValueOnce(new Error("Resend answered 403: domain not verified"));
    expect(await requestSignup(form(), null)).toEqual({ ok: true, email: EMAIL });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Sign-up email to newbie@example.com failed"),
      expect.any(Error),
    );
  });

  it("replaces the pending sign-up when a new one is asked for", async () => {
    await requestSignup(form({ name: "First Try" }), null);
    const first = codeFromEmail(0);
    await requestSignup(form({ name: "Second Try", password: "another-pass-99", confirmPassword: "another-pass-99" }), null);
    const second = codeFromEmail(1);
    expect(await prisma.signupRequest.count()).toBe(1);

    if (first !== second) {
      expect(await completeSignup(verify(first), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    }
    expect(await completeSignup(verify(second), null)).toMatchObject({ ok: true });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.name).toBe("Second Try");
    expect(await verifyPassword("another-pass-99", user.passwordHash)).toBe(true);
  });

  // ── Step 2 ──────────────────────────────────────────────────────────────

  it("makes a Staff account with the chosen password, tidies up, and moves the board revision", async () => {
    await makeUser();
    await requestSignup(form(), "203.0.113.5");
    const code = codeFromEmail();
    const before = await readRevision();

    const result = await completeSignup(verify(` ${code} `, "NEWBIE@example.com"), "203.0.113.5");
    expect(result).toMatchObject({ ok: true, user: { email: EMAIL } });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user).toMatchObject({
      name: "Asha Patel",
      role: "STAFF",
      mustChangePassword: false,
      active: true,
      color: colorForSeed(EMAIL),
    });
    expect(await verifyPassword(PASSWORD, user.passwordHash)).toBe(true);
    expect(await prisma.signupRequest.count()).toBe(0);
    expect(await readRevision()).toBe(before + 1);
    for (const key of signupKeys.verify(EMAIL, "203.0.113.5")) {
      expect(await prisma.loginAttempt.findUnique({ where: { key } })).toBeNull();
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Self sign-up: newbie@example.com joined"));
  });

  it("signs the new person in through the action and lands them on the board", async () => {
    await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();

    expect(await redirectOf(() => completeSignupAction(null, formData({ email: EMAIL, code })))).toBe("/");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(signIn).toHaveBeenCalledTimes(1);
    const [provider, options] = vi.mocked(signIn).mock.calls[0]! as unknown as [string, { ticket: string; redirect: boolean }];
    expect(provider).toBe("signup-ticket");
    expect(options.redirect).toBe(false);
    // The ticket is what the provider accepts, and it names this account.
    expect(await userForTicket(options.ticket)).toEqual({
      id: user.id,
      email: EMAIL,
      name: "Asha Patel",
      sessionVersion: user.sessionVersion,
    });
  });

  it("only honours a sign-in ticket that is genuine, fresh and for an account still as it was", async () => {
    const user = await makeUser({ email: "t@example.com", role: "STAFF" });
    const ticket = issueSigninTicket(user);
    expect(await userForTicket(ticket)).toMatchObject({ id: user.id });

    const [id, version, expires, mac] = ticket.split(".");
    expect(await userForTicket(`${id}.${version}.${Number(expires) + 1000}.${mac}`)).toBeNull();
    expect(await userForTicket(`${id}.${version}.${expires}.${"0".repeat(64)}`)).toBeNull();
    expect(await userForTicket("nonsense")).toBeNull();
    expect(await userForTicket(undefined)).toBeNull();
    expect(await userForTicket(issueSigninTicket(user, Date.now() - 3 * 60 * 1000))).toBeNull();

    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await userForTicket(ticket)).toBeNull();
    const fresh = issueSigninTicket(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await userForTicket(fresh)).toBeNull();
  });

  it("refuses a wrong code, and the code dies after five wrong tries", async () => {
    await requestSignup(form(), null);
    const code = codeFromEmail();
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      expect(await completeSignup(verify(otherThan(code)), null)).toEqual({
        ok: false,
        code: "WRONG_CODE",
        error: WRONG_CODE_MESSAGE,
      });
    }
    expect((await prisma.signupRequest.findFirstOrThrow()).attempts).toBe(CODE_MAX_ATTEMPTS);
    // Lift the verify limiter, which has also had five tries, to reach the code's own limit.
    await prisma.loginAttempt.deleteMany();
    expect(await completeSignup(verify(code), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("refuses an expired code", async () => {
    await requestSignup(form(), null);
    const code = codeFromEmail();
    await prisma.signupRequest.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await completeSignup(verify(code), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("refuses a used code, and two right answers at once make one account", async () => {
    await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();
    const results = await Promise.all([completeSignup(verify(code), null), completeSignup(verify(code), null)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "WRONG_CODE" });
    expect(await completeSignup(verify(code), null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(1);
    expect(await prisma.teamEvent.count()).toBe(1);
  });

  it("refuses a code for an address that has no pending sign-up", async () => {
    expect(await completeSignup(verify("123456", "nobody@example.com"), null)).toEqual({
      ok: false,
      code: "WRONG_CODE",
      error: WRONG_CODE_MESSAGE,
    });
  });

  it("checks the form before spending a try", async () => {
    await requestSignup(form(), null);
    expect(await completeSignup(verify("12345"), null)).toMatchObject({
      code: "INVALID",
      error: "Enter the 6-digit code from the email.",
    });
    expect((await prisma.signupRequest.findFirstOrThrow()).attempts).toBe(0);
  });

  it("refuses cleanly when the address was registered between request and verify", async () => {
    const owner = await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();
    // An owner adds them by hand meanwhile (any case of the address).
    await prisma.user.create({
      data: { email: "Newbie@Example.com", name: "Added By Owner", role: "STAFF", passwordHash: "x", color: "rust" },
    });

    expect(await completeSignup(verify(code), null)).toEqual({ ok: false, code: "TAKEN", error: EMAIL_TAKEN_MESSAGE });
    expect(await prisma.user.count()).toBe(2);
    expect(await prisma.signupRequest.count()).toBe(0);
    expect(await prisma.teamEvent.count()).toBe(0);
    expect((await getNotificationFeed(owner)).items).toHaveLength(0);
    // The action shows the reason rather than redirecting.
    await requestSignup(form({ email: "other@example.com" }), null);
    const other = codeFromEmail();
    await prisma.user.create({
      data: { email: "other@example.com", name: "Other", role: "STAFF", passwordHash: "x", color: "rust" },
    });
    expect(await redirectOf(() => completeSignupAction(null, formData({ email: "other@example.com", code: other })))).toEqual({
      error: EMAIL_TAKEN_MESSAGE,
      values: { email: "other@example.com" },
    });
  });

  // ── Owners are told ─────────────────────────────────────────────────────

  it("tells every active owner, in the bell and by push, and nobody else", async () => {
    const owner = await makeUser();
    const other = await makeUser({ email: "owner2@example.com", name: "Second Owner" });
    const retired = await makeUser({ email: "retired@example.com", name: "Retired Owner", active: false });
    const staff = await makeUser({ email: "staff@example.com", name: "Staff", role: "STAFF" });
    for (const [user, n] of [[owner, 1], [other, 2], [retired, 3], [staff, 4]] as const) {
      await prisma.pushSubscription.create({
        data: { userId: user.id, endpoint: `https://push.example.com/${n}`, p256dh: "k", auth: "a" },
      });
    }

    await requestSignup(form(), null);
    expect(await completeSignup(verify(codeFromEmail()), null)).toMatchObject({ ok: true });
    const joined = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });

    for (const reader of [owner, other]) {
      const feed = await getNotificationFeed(reader);
      expect(feed.unread).toBe(1);
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0]).toMatchObject({
        kind: "team",
        type: "joined",
        actorId: joined.id,
        actorName: "Asha Patel",
        text: "joined the board as Staff",
        taskId: null,
        taskTitle: null,
        unread: true,
      });
      expect(`${feed.items[0]!.actorName} ${feed.items[0]!.text}.`).toBe("Asha Patel joined the board as Staff.");
    }
    // Staff, and the newcomer themselves, are not told.
    expect(await getNotificationFeed(staff)).toMatchObject({ items: [], unread: 0 });
    expect(await getNotificationFeed(joined)).toMatchObject({ items: [], unread: 0 });

    // The push goes after the response, to the active owners' devices only.
    expect(pushed).not.toHaveBeenCalled();
    await flushAfter();
    const endpoints = pushed.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(endpoints).toEqual(["https://push.example.com/1", "https://push.example.com/2"]);
    expect(JSON.parse(pushed.mock.calls[0]![1] as string)).toMatchObject({
      body: "Asha Patel joined the board as Staff",
      url: "/team",
    });
  });

  it("merges team events into an owner's feed by time, against the same read watermark", async () => {
    const owner = await makeUser();
    await prisma.user.update({ where: { id: owner.id }, data: { notificationReadAt: new Date() } });
    await requestSignup(form(), null);
    await completeSignup(verify(codeFromEmail()), null);
    const joined = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    // The newcomer then does something on the board.
    const task = await prisma.task.create({
      data: { title: "Order cups", position: 1, createdById: owner.id, updatedById: owner.id },
    });
    await prisma.activity.create({ data: { taskId: task.id, actorId: joined.id, type: "commented" } });

    const feed = await getNotificationFeed(owner);
    expect(feed.items.map((i) => i.kind)).toEqual(["task", "team"]);
    expect(feed.unread).toBe(2);

    await prisma.user.update({ where: { id: owner.id }, data: { notificationReadAt: new Date() } });
    expect((await getNotificationFeed(owner)).unread).toBe(0);
  });

  // ── Limits ──────────────────────────────────────────────────────────────

  it("caps sign-up requests per address, and says how long to wait", async () => {
    for (let i = 0; i < EMAIL_MAX; i++) {
      expect(await requestSignup(form(), `198.51.100.${i}`)).toMatchObject({ ok: true });
    }
    expect(await requestSignup(form(), "192.0.2.1")).toMatchObject({ ok: false, code: "LOCKED" });
    expect(sent).toHaveBeenCalledTimes(EMAIL_MAX);
    // A registered address is limited exactly the same, so the limit reveals nothing.
    await makeUser({ email: "staff@example.com", role: "STAFF" });
    for (let i = 0; i < EMAIL_MAX; i++) await requestSignup(form({ email: "staff@example.com" }), null);
    expect(await requestSignup(form({ email: "staff@example.com" }), null)).toMatchObject({ code: "LOCKED" });

    expect(await redirectOf(() => requestSignupAction(null, formData(form())))).toEqual({
      error: "Too many attempts. Try again in 15 minutes.",
      values: { name: "Asha Patel", email: EMAIL },
    });
  });

  it("caps sign-up requests per network address, with the roomier IP limit", async () => {
    for (let i = 0; i < IP_MAX; i++) {
      expect(await requestSignup(form({ email: `person${i}@example.com` }), "203.0.113.50")).toMatchObject({ ok: true });
    }
    expect(await requestSignup(form({ email: "one-more@example.com" }), "203.0.113.50")).toMatchObject({
      code: "LOCKED",
    });
    expect(await requestSignup(form({ email: "one-more@example.com" }), "198.51.100.9")).toMatchObject({ ok: true });
  });

  it("caps verify attempts per address even across fresh codes", async () => {
    for (let i = 0; i < EMAIL_MAX; i++) {
      await requestSignup(form(), null);
      const code = codeFromEmail();
      await prisma.loginAttempt.deleteMany({ where: { key: { startsWith: "signup-req" } } });
      expect(await completeSignup(verify(otherThan(code)), `198.51.100.${i}`)).toMatchObject({ code: "WRONG_CODE" });
    }
    await requestSignup(form(), null);
    const result = await completeSignup(verify(codeFromEmail()), "192.0.2.1");
    expect(result).toMatchObject({ ok: false, code: "LOCKED" });
    if (!result.ok) expect(result.retryAfterSec).toBeGreaterThan(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("caps verify attempts per network address", async () => {
    for (let i = 0; i < IP_MAX; i++) {
      expect(await completeSignup(verify("123456", `p${i}@example.com`), "203.0.113.60")).toMatchObject({
        code: "WRONG_CODE",
      });
    }
    expect(await completeSignup(verify("123456", "p-last@example.com"), "203.0.113.60")).toMatchObject({
      code: "LOCKED",
    });
  });

  // ── The owners' switch, and email ───────────────────────────────────────

  it("is open by default and offered on the sign-in page", async () => {
    await makeUser();
    expect(await readSignupsOpen()).toBe(true);
    expect(await signupsAvailable()).toBe(true);
    expect(hrefs(await loginPage())).toContain("/signup");
    expect(await pageOutcome(() => SignupPage())).toBe("rendered");
    expect(await pageOutcome(verifyPage)).toBe("rendered");
  });

  it("closed by an owner: the link goes, both pages 404, and both steps are refused", async () => {
    const owner = await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();

    expect(await setSignupsOpen(owner, false)).toMatchObject({ ok: true, data: { signupsOpen: false } });
    expect(await readSignupsOpen()).toBe(false);
    // Closing throws away sign-ups still waiting for their code.
    expect(await prisma.signupRequest.count()).toBe(0);

    expect(hrefs(await loginPage())).not.toContain("/signup");
    expect(await pageOutcome(() => SignupPage())).toBe("404");
    expect(await pageOutcome(verifyPage)).toBe("404");
    expect(await requestSignup(form({ email: "late@example.com" }), null)).toMatchObject({ ok: false, code: "DISABLED" });
    expect(await completeSignup(verify(code), null)).toMatchObject({ ok: false, code: "DISABLED" });
    expect(await redirectOf(() => requestSignupAction(null, formData(form())))).toBe("/login");
    expect(sent).toHaveBeenCalledTimes(1);
    expect(await prisma.user.count()).toBe(1);

    // And open again.
    expect(await setSignupsOpen(owner, true)).toMatchObject({ ok: true, data: { signupsOpen: true } });
    expect(hrefs(await loginPage())).toContain("/signup");
  });

  it("refuses a code whose sign-up was closed between request and verify", async () => {
    const owner = await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();
    // Closed straight in the table, so the pending row survives to reach the re-check.
    await prisma.boardSetting.create({ data: { id: 1, signupsOpen: false } });
    expect(await completeSignup(verify(code), null)).toMatchObject({ code: "DISABLED" });
    await prisma.boardSetting.update({ where: { id: 1 }, data: { signupsOpen: true } });
    expect(await completeSignup(verify(code), null)).toMatchObject({ ok: true });
    expect(owner).toBeTruthy();
  });

  it("only lets an active owner open or close sign-ups", async () => {
    const owner = await makeUser();
    const staff = await makeUser({ email: "staff@example.com", role: "STAFF" });
    expect(await setSignupsOpen(staff, false)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // A session that still says owner, for an account demoted since.
    const demoted = await makeUser({ email: "was-owner@example.com", role: "STAFF" });
    expect(await setSignupsOpen({ id: demoted.id, role: "OWNER" }, false)).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await setSignupsOpen(owner, "no")).toMatchObject({ ok: false, code: "INVALID" });
    expect(await readSignupsOpen()).toBe(true);
  });

  it("is all off without email sending, whatever the switch says", async () => {
    await makeUser();
    await requestSignup(form(), null);
    const code = codeFromEmail();
    for (const [key, from] of [
      ["", "GC Tasks <tasks@example.com>"],
      ["re_test_key", ""],
    ]) {
      vi.stubEnv("RESEND_API_KEY", key!);
      vi.stubEnv("EMAIL_FROM", from!);
      expect(await readSignupsOpen()).toBe(true);
      expect(await signupsAvailable()).toBe(false);
      expect(hrefs(await loginPage())).not.toContain("/signup");
      expect(await pageOutcome(() => SignupPage())).toBe("404");
      expect(await pageOutcome(verifyPage)).toBe("404");
      expect(await requestSignup(form({ email: "x@example.com" }), null)).toMatchObject({ code: "DISABLED" });
      expect(await completeSignup(verify(code), null)).toMatchObject({ code: "DISABLED" });
    }
    expect(sent).toHaveBeenCalledTimes(1);
    expect(await prisma.user.count()).toBe(1);
  });
});

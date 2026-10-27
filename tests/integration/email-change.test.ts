import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  Changing your own email, against a real Postgres: the current password is
  required, the code goes to the NEW address, nothing changes until it is
  entered, the code's limits hold, a taken address is refused, and the old
  address is told afterwards.

  The sender is mocked, so nothing here touches the network. Empties every
  table between tests, so it only runs against a database whose URL says it
  is a test one.
*/

vi.mock("@/modules/email/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/modules/email/send")>();
  return { ...original, sendEmail: vi.fn(async () => {}) };
});

import { prisma } from "@/lib/prisma";
import { colorForSeed } from "@/lib/colors";
import { hashPassword } from "@/modules/auth/password";
import {
  CODE_MAX_ATTEMPTS,
  confirmEmailChange,
  EMAIL_TAKEN_MESSAGE,
  requestEmailChange,
  WRONG_CODE_MESSAGE,
} from "@/modules/auth/email-change";
import { sendEmail, type OutgoingEmail } from "@/modules/email/send";

const enabled = (process.env.DATABASE_URL ?? "").includes("test");
const PASSWORD = "my-password-123";
const sent = vi.mocked(sendEmail);

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "EmailChangeRequest", "LoginAttempt", "User" RESTART IDENTITY CASCADE`,
  );
  sent.mockReset();
  sent.mockImplementation(async () => {});
}

async function makeUser(email = "old@example.com") {
  return prisma.user.create({
    data: { email, name: "Sam", role: "STAFF", passwordHash: await hashPassword(PASSWORD), color: colorForSeed(email) },
  });
}

/** The code in the last email sent to `to`. */
function codeSentTo(to: string): string {
  const mail = sent.mock.calls.map((c) => c[0] as OutgoingEmail).filter((m) => m.to === to).at(-1);
  const code = mail?.text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

describe.skipIf(!enabled)("email change (integration)", () => {
  beforeEach(async () => {
    await reset();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "GC Tasks <tasks@example.com>");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("emails a code to the new address and changes the email only once it's entered", async () => {
    const user = await makeUser();
    expect(await requestEmailChange(user.id, { newEmail: " New@Example.com ", password: PASSWORD }, null)).toEqual({
      ok: true,
      newEmail: "new@example.com",
    });
    expect(sent).toHaveBeenCalledTimes(1);
    const code = codeSentTo("new@example.com");
    // Nothing has changed yet.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("old@example.com");

    expect(await confirmEmailChange(user.id, { code }, null)).toEqual({ ok: true, email: "new@example.com" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe("new@example.com");
    // Still signed in: the session version is untouched.
    expect(after.sessionVersion).toBe(user.sessionVersion);
    // The old address is told, and the code works once.
    expect((sent.mock.calls.at(-1)![0] as OutgoingEmail)).toMatchObject({ to: "old@example.com" });
    expect(await confirmEmailChange(user.id, { code }, null)).toMatchObject({ ok: false, code: "NO_REQUEST" });
  });

  it("needs the current password, and sends nothing without it", async () => {
    const user = await makeUser();
    expect(await requestEmailChange(user.id, { newEmail: "new@example.com", password: "wrong-one" }, null)).toMatchObject({
      ok: false,
      code: "WRONG_PASSWORD",
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("refuses an address another account has, or the one you already have", async () => {
    const user = await makeUser();
    await makeUser("taken@example.com");
    expect(await requestEmailChange(user.id, { newEmail: "TAKEN@example.com", password: PASSWORD }, null)).toMatchObject({
      ok: false,
      code: "TAKEN",
      error: EMAIL_TAKEN_MESSAGE,
    });
    expect(await requestEmailChange(user.id, { newEmail: "old@example.com", password: PASSWORD }, null)).toMatchObject({
      ok: false,
      code: "SAME",
    });
  });

  it("refuses at the last step if the address was taken while the code was out", async () => {
    const user = await makeUser();
    await requestEmailChange(user.id, { newEmail: "new@example.com", password: PASSWORD }, null);
    await makeUser("new@example.com");
    expect(await confirmEmailChange(user.id, { code: codeSentTo("new@example.com") }, null)).toMatchObject({
      ok: false,
      code: "TAKEN",
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("old@example.com");
  });

  it("stops accepting codes after five wrong tries", async () => {
    const user = await makeUser();
    await requestEmailChange(user.id, { newEmail: "new@example.com", password: PASSWORD }, null);
    const right = codeSentTo("new@example.com");
    const wrongCode = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) {
      expect(await confirmEmailChange(user.id, { code: wrongCode }, null)).toMatchObject({ error: WRONG_CODE_MESSAGE });
    }
    // Even the right code is refused now (the code is spent, and the account is locked out for a while).
    expect(await confirmEmailChange(user.id, { code: right }, null)).toMatchObject({ ok: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe("old@example.com");
  });

  it("replaces the pending change when you ask again", async () => {
    const user = await makeUser();
    await requestEmailChange(user.id, { newEmail: "new@example.com", password: PASSWORD }, null);
    const first = codeSentTo("new@example.com");
    await requestEmailChange(user.id, { newEmail: "other@example.com", password: PASSWORD }, null);
    const second = codeSentTo("other@example.com");
    expect(await prisma.emailChangeRequest.count()).toBe(1);
    if (second !== first) {
      expect(await confirmEmailChange(user.id, { code: first }, null)).toMatchObject({ ok: false, code: "WRONG_CODE" });
    }
    expect(await confirmEmailChange(user.id, { code: second }, null)).toEqual({ ok: true, email: "other@example.com" });
  });

  it("tells you when the code couldn't be sent, and keeps no pending change", async () => {
    const user = await makeUser();
    sent.mockRejectedValueOnce(new Error("Resend answered 422"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestEmailChange(user.id, { newEmail: "new@example.com", password: PASSWORD }, null)).toMatchObject({
      ok: false,
      code: "SEND_FAILED",
    });
    expect(await prisma.emailChangeRequest.count()).toBe(0);
  });

  it("is off while email sending isn't configured", async () => {
    const user = await makeUser();
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await requestEmailChange(user.id, { newEmail: "new@example.com", password: PASSWORD }, null)).toMatchObject({
      ok: false,
      code: "DISABLED",
    });
  });
});

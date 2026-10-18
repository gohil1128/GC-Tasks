import { describe, expect, it } from "vitest";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { authConfig, tokenSessionVersion } from "@/lib/auth.config";

/*
  The token half of signing out old sessions: the account's sessionVersion is
  stamped into the token at sign-in, kept on every later request (when there
  is no user to read it from), and handed to currentUser() on the session.
  currentUser()'s comparison with the database is pinned in
  tests/integration/auth.test.ts.
*/

const { jwt, session } = authConfig.callbacks!;

async function signIn(user: User): Promise<JWT> {
  const token = (await jwt!({ token: { sub: user.id }, user } as Parameters<NonNullable<typeof jwt>>[0])) as JWT;
  // Every request after sign-in runs the callback again without a user.
  return (await jwt!({ token } as Parameters<NonNullable<typeof jwt>>[0])) as JWT;
}

async function sessionFrom(token: JWT): Promise<Session> {
  const base = { user: { name: "Sam" }, expires: new Date(Date.now() + 60_000).toISOString() };
  return (await session!({ session: base, token } as unknown as Parameters<NonNullable<typeof session>>[0])) as Session;
}

describe("session version in the token", () => {
  it("is stamped at sign-in and survives later requests", async () => {
    const token = await signIn({ id: "u1", email: "sam@example.com", sessionVersion: 3 });
    expect(token).toMatchObject({ id: "u1", sessionVersion: 3 });
    const s = await sessionFrom(token);
    expect(s.user.id).toBe("u1");
    expect(s.sessionVersion).toBe(3);
  });

  it("counts a token from before versions existed as version 0, so the deploy signs nobody out", async () => {
    const s = await sessionFrom({ id: "u1", sub: "u1" });
    expect(s.sessionVersion).toBe(0);
  });

  it("treats anything but a whole number as 0", () => {
    for (const value of [undefined, null, "2", 1.5, Number.NaN, {}]) expect(tokenSessionVersion(value)).toBe(0);
    expect(tokenSessionVersion(0)).toBe(0);
    expect(tokenSessionVersion(7)).toBe(7);
  });
});

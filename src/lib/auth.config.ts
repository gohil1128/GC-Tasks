import type { NextAuthConfig } from "next-auth";

/*
  The account's sessionVersion as it stood when this token was issued.
  Tokens from before the column existed carry none and count as 0, its
  default, so the deploy that added it signed nobody out.
*/
export function tokenSessionVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

// Edge-safe half of the auth setup, used by middleware. Must not import bcrypt
// or Prisma; the provider that does lives in src/lib/auth.ts.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      // user is only there at sign-in. The middleware cannot reach the
      // database to compare the version; currentUser() does, on every request.
      if (user?.id) {
        token.id = user.id;
        token.sessionVersion = user.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) session.user.id = token.id as string;
      if (token) session.sessionVersion = tokenSessionVersion(token.sessionVersion);
      return session;
    },
  },
};

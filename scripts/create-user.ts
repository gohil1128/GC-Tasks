/*
  Create or reset an account from the command line.

    pnpm create-user --email you@example.com --name "Your Name" [--password "…"] [--role owner|staff]
    pnpm create-user --email you@example.com --reset [--password "…"] [--role owner|staff] [--name "…"]

  For CI (which needs an account to run the end-to-end tests against) and as
  the way back in if the owners are ever all locked out. Without --password one
  is generated and printed, and the person must choose their own at first
  sign-in, exactly as if an owner had added them from the Team page.

  The role defaults to owner on an empty database — the first account has to
  be able to run the board — and to staff after that, the narrower choice. On
  --reset the role is left alone unless --role is given.

  Talks to the database directly with its own PrismaClient: this runs outside
  Next.js, with no request and nobody signed in.
*/
import { parseArgs } from "node:util";
import { PrismaClient, type Role } from "@prisma/client";
import type { SafeParseReturnType } from "zod";
import { colorForSeed } from "../src/lib/colors";
import { generatePassword, hashPassword, passwordSchema } from "../src/modules/auth/password";
import { emailSchema, nameSchema } from "../src/modules/team/schemas";

const USAGE = `Usage:
  pnpm create-user --email <email> --name <name> [--password <password>] [--role owner|staff]
  pnpm create-user --email <email> --reset [--password <password>] [--role owner|staff] [--name <name>]`;

/** The command was written wrong: say so and show how it is used. */
class UsageError extends Error {}
/** Written right, but refused: the message is enough. */
class Refused extends Error {}

function parseRole(value: string | undefined): Role | undefined {
  if (value === undefined) return undefined;
  const role = value.trim().toUpperCase();
  if (role !== "OWNER" && role !== "STAFF") throw new UsageError(`--role must be "owner" or "staff", not "${value}".`);
  return role;
}

function check<T>(result: SafeParseReturnType<unknown, T>, flag: string): T {
  if (!result.success) throw new UsageError(`${flag}: ${result.error.issues[0]?.message ?? "not valid"}`);
  return result.data;
}

const ROLE_WORD: Record<Role, string> = { OWNER: "owner", STAFF: "staff" };

async function main(prisma: PrismaClient): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      password: { type: "string" },
      role: { type: "string" },
      reset: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!values.email) throw new UsageError("--email is required.");

  const email = check(emailSchema.safeParse(values.email), "--email");
  const name = values.name === undefined ? undefined : check(nameSchema.safeParse(values.name), "--name");
  const requestedRole = parseRole(values.role);
  const generated = values.password === undefined;
  const password = generated ? generatePassword() : check(passwordSchema.safeParse(values.password), "--password");
  const passwordHash = await hashPassword(password);

  // lower() against lower(), not Prisma's insensitive mode: that is ILIKE with
  // the address as the pattern, where "_" and "%" match other addresses.
  const [match] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User" WHERE lower("email") = lower(${email}) LIMIT 1`;
  const existing = match ? await prisma.user.findUnique({ where: { id: match.id } }) : null;

  let role: Role;
  let verb: string;
  if (values.reset) {
    if (!existing) throw new Refused(`No account uses ${email}. Leave out --reset to create one.`);
    role = requestedRole ?? existing.role;
    if (existing.role === "OWNER" && role === "STAFF" && existing.active) {
      const others = await prisma.user.count({ where: { role: "OWNER", active: true, id: { not: existing.id } } });
      if (others === 0) throw new Refused(`${existing.email} is the last active owner and cannot be made staff.`);
    }
    // The board row first: every board write locks it before any user row,
    // and taking them in the other order could deadlock with one.
    await prisma.$transaction([
      prisma.boardRevision.upsert({
        where: { id: 1 },
        create: { id: 1, revision: 1 },
        update: { revision: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          mustChangePassword: generated,
          role,
          // A new password signs out every session issued with the old one.
          sessionVersion: { increment: 1 },
          ...(name ? { name } : {}),
        },
      }),
      // Usually the reason for running this: a lockout after too many tries.
      prisma.loginAttempt.deleteMany({ where: { key: `email:${existing.email}` } }),
    ]);
    verb = "Reset";
    if (!existing.active) {
      console.warn(`Note: this account is deactivated and still cannot sign in. Reactivate it from the Team page.`);
    }
  } else {
    if (existing) throw new Refused(`An account already uses ${existing.email}. Add --reset to reset its password.`);
    if (!name) throw new UsageError("--name is required when creating an account.");
    role = requestedRole ?? ((await prisma.user.count()) === 0 ? "OWNER" : "STAFF");
    await prisma.$transaction([
      prisma.boardRevision.upsert({
        where: { id: 1 },
        create: { id: 1, revision: 1 },
        update: { revision: { increment: 1 } },
      }),
      prisma.user.create({
        data: { email, name, passwordHash, role, mustChangePassword: generated, color: colorForSeed(email) },
      }),
    ]);
    verb = "Created";
  }

  console.log(`${verb} ${ROLE_WORD[role]} account for ${name ?? existing?.name} <${email}>.`);
  console.log(`Role: ${ROLE_WORD[role]}`);
  if (generated) {
    console.log(`Temporary password: ${password}`);
    console.log("Share it privately. They will be asked to choose their own password when they sign in.");
  } else {
    console.log("Password set as given.");
  }
}

const prisma = new PrismaClient();
main(prisma)
  .catch((err: unknown) => {
    if (err instanceof Refused) {
      console.error(err.message);
    } else if (err instanceof UsageError || (err instanceof Error && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))) {
      console.error(err.message);
      console.error(USAGE);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/*
  What a team write answers when Postgres gives up on it for a lock reason,
  with the database stubbed out: real deadlocks are not something a test can
  order up on demand once the code takes its locks in one order.
*/

const transaction = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (...args: unknown[]) => transaction(...args) } }));

const { setMemberActive, updateProfile } = await import("@/modules/team/service");

const owner = { id: "o1", role: "OWNER" as const };
const CLASHED = "Someone else changed the team at the same moment. Try again.";
const meta = { clientVersion: "5.22.0" };

beforeEach(() => transaction.mockReset());

describe("team writes caught in a lock clash", () => {
  it("answer a deadlock as a refusal to try again, however Prisma reports it", async () => {
    const shapes = [
      // From a model call (an update, an upsert).
      new Prisma.PrismaClientUnknownRequestError(
        'Error occurred during query execution: ConnectorError(... code: "40P01", message: "deadlock detected" ...)',
        meta,
      ),
      // From a raw statement, such as the board lock.
      new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`", {
        ...meta,
        code: "P2010",
      }),
      new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict or a deadlock.", {
        ...meta,
        code: "P2034",
      }),
    ];
    for (const err of shapes) {
      transaction.mockRejectedValueOnce(err);
      expect(await updateProfile(owner, { name: "Asha", color: "teal" })).toEqual({
        ok: false,
        code: "INVALID",
        error: CLASHED,
      });
      transaction.mockRejectedValueOnce(err);
      expect(await setMemberActive(owner, "s1", false)).toEqual({ ok: false, code: "INVALID", error: CLASHED });
    }
  });

  it("still lets any other database failure surface", async () => {
    transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `42P01`.", { ...meta, code: "P2010" }),
    );
    await expect(updateProfile(owner, { name: "Asha", color: "teal" })).rejects.toThrow("42P01");
  });
});

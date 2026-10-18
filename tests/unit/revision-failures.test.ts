import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { asFailure } from "@/modules/tasks/revision";

/*
  A deadlock has no Prisma error code of its own, and how it arrives depends
  on the statement that lost: a model call reports an unknown request error,
  a raw statement (lockBoard is one) a P2010 carrying Postgres's 40P01.
  Either way the person should be told to try again, not shown a crash.
*/
describe("asFailure", () => {
  const clash = { ok: false, code: "CONFLICT", error: "Someone else changed the board at the same moment. Try again." };

  it("answers a deadlock as a conflict to retry, however Prisma reports it", () => {
    const unknown = new Prisma.PrismaClientUnknownRequestError("ERROR: deadlock detected (40P01)", {
      clientVersion: "5",
    });
    const raw = new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `40P01`. Message: `deadlock detected`", {
      code: "P2010",
      clientVersion: "5",
    });
    const serialization = new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", {
      code: "P2034",
      clientVersion: "5",
    });
    expect(asFailure(unknown)).toEqual(clash);
    expect(asFailure(raw)).toEqual(clash);
    expect(asFailure(serialization)).toEqual(clash);
  });

  it("lets any other database failure surface", () => {
    const other = new Prisma.PrismaClientUnknownRequestError("ERROR: invalid byte sequence", { clientVersion: "5" });
    expect(asFailure(other)).toBeNull();
    expect(asFailure(new Error("boom"))).toBeNull();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";
import * as labels from "@/modules/labels/service";
import type { ActionResult } from "@/modules/tasks/types";
import { createLabelSchema, updateLabelSchema } from "@/modules/tasks/validation";

/*
  Label names against a real Postgres: "unique ignoring case" is decided by
  the database, so it is only worth pinning there.

  Empties every table between tests, so it only runs against a database whose
  URL says it is a test one.
*/

const url = process.env.DATABASE_URL ?? "";
const enabled = url.includes("test");

async function reset() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "LoginAttempt", "BoardRevision", "User" RESTART IDENTITY CASCADE`,
  );
}

async function makeOwner(): Promise<Actor> {
  const row = await prisma.user.create({
    data: { email: "owner@example.com", name: "Owner", role: "OWNER", passwordHash: "x" },
  });
  return { id: row.id, role: row.role };
}

const create = (actor: Actor, name: string) => labels.createLabel(actor, createLabelSchema.parse({ name, color: "teal" }));

function outcome<T>(r: ActionResult<T>): string {
  return r.ok ? "created" : `${r.code}: ${r.error}`;
}

/** Sorted here rather than by the database, whose collation may not order case the same way. */
async function names() {
  return (await prisma.label.findMany({ select: { name: true } })).map((l) => l.name).sort();
}

describe.skipIf(!enabled)("label names (integration)", () => {
  let owner: Actor;
  beforeEach(async () => {
    await reset();
    owner = await makeOwner();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("treats % and _ as ordinary characters, not wildcards", async () => {
    expect((await create(owner, "Kitchen")).ok).toBe(true);
    for (const name of ["K_tchen", "Kit%", "%", "_______"]) {
      expect(outcome(await create(owner, name))).toBe("created");
    }
    expect(outcome(await create(owner, "kitchen"))).toBe("INVALID: A label called “Kitchen” already exists.");
  });

  it("treats a backslash literally: no case-variant slips past, and no repeat crashes", async () => {
    expect(outcome(await create(owner, "A\\B"))).toBe("created");
    expect(outcome(await create(owner, "a\\b"))).toBe("INVALID: A label called “A\\B” already exists.");
    expect(outcome(await create(owner, "A\\B"))).toBe("INVALID: A label called “A\\B” already exists.");
    expect(outcome(await create(owner, "Back\\"))).toBe("created");
    expect(outcome(await create(owner, "back\\"))).toBe("INVALID: A label called “Back\\” already exists.");
    expect(await names()).toEqual(["A\\B", "Back\\"]);
  });

  it("checks a rename the same way, still allowing a label's own name in another case", async () => {
    const ab = await create(owner, "A\\B");
    const other = await create(owner, "Other");
    if (!ab.ok || !other.ok) throw new Error("setup failed");
    const rename = (id: string, name: string) => labels.updateLabel(owner, updateLabelSchema.parse({ id, name }));

    expect(await rename(other.data.id, "a\\b")).toMatchObject({ ok: false, code: "INVALID" });
    expect(await rename(other.data.id, "O_her")).toMatchObject({ ok: true });
    expect(await rename(ab.data.id, "a\\b")).toMatchObject({ ok: true });
    expect(await names()).toEqual(["O_her", "a\\b"]);
  });

  it("answers a clash the database catches itself with a sentence, not a crash", async () => {
    // A writer outside the board lock (a script, say) inserts the same name
    // and commits only after the service has checked and is inserting.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const outsideInserted = new Promise<void>((r) => (inserted = r));
    const outside = prisma.$transaction(
      async (tx) => {
        await tx.label.create({ data: { name: "Race", color: "rust" } });
        inserted();
        await gate;
      },
      { timeout: 20_000 },
    );
    await outsideInserted;

    const attempt = create(owner, "Race");
    for (let i = 0; i < 200; i++) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((row?.n ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    release();
    await outside;

    const [result] = await Promise.allSettled([attempt]);
    expect(result).toMatchObject({ status: "fulfilled", value: { ok: false, code: "INVALID" } });
    expect(await names()).toEqual(["Race"]);
  });
});

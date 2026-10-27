import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
  A teammate's profile (/team/[id]): every change that person made, newest
  first, across the whole board — owners read it, so it includes tasks staff
  could not see. Empties every table, so it runs only on a test database.
*/

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const { prisma } = await import("@/lib/prisma");
const svc = await import("@/modules/tasks/service");
const { createTaskSchema, moveTaskSchema } = await import("@/modules/tasks/validation");
const { getMemberProfile } = await import("@/modules/team/activity");
type Actor = import("@/lib/permissions").Actor;
type Role = import("@/lib/permissions").Role;

const RUN = (process.env.DATABASE_URL ?? "").includes("test");

let seq = 0;
async function makeUser(name: string, role: Role): Promise<Actor> {
  const user = await prisma.user.create({
    data: { name, email: `${name.toLowerCase()}-${++seq}@example.test`, passwordHash: "x", role },
  });
  return { id: user.id, role };
}

function data<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

describe.skipIf(!RUN)("member activity (integration)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE "Activity", "Comment", "ChecklistItem", "TaskLabel", "TaskAssignee", "Task", "Label", "User", "BoardRevision" CASCADE`,
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists only that person's changes, newest first, with the task each was on", async () => {
    const owner = await makeUser("Olivia", "OWNER");
    const staff = await makeUser("Sam", "STAFF");
    const task = data(await svc.createTask(owner, createTaskSchema.parse({ title: "Order cups", assigneeIds: [] })));

    data(await svc.joinTask(staff, task.id));
    data(await svc.moveTask(staff, moveTaskSchema.parse({ id: task.id, status: "IN_PROGRESS", afterId: null, beforeId: null })));
    data(await svc.addComment(staff, { taskId: task.id, body: "On it" }));

    const profile = await getMemberProfile(staff.id);
    expect(profile).toMatchObject({ id: staff.id, name: "Sam", role: "STAFF", totalChanges: 3 });
    expect(profile!.activity.map((a) => a.type)).toEqual(["commented", "moved", "assigned"]);
    expect(profile!.activity.every((a) => a.taskTitle === "Order cups" && a.taskId === task.id)).toBe(true);
    expect(profile!.activity[0]!.text).toBeTruthy();

    // The owner's own change (creating the task) is on their profile, not Sam's.
    expect((await getMemberProfile(owner.id))!.activity.map((a) => a.type)).toEqual(["created"]);
  });

  it("includes changes on tasks staff can't see, and marks archived ones", async () => {
    const owner = await makeUser("Olivia", "OWNER");
    const task = data(await svc.createTask(owner, createTaskSchema.parse({ title: "Owner only", assigneeIds: [owner.id] })));
    data(await svc.moveTask(owner, moveTaskSchema.parse({ id: task.id, status: "DONE", afterId: null, beforeId: null })));
    data(await svc.archiveTask(owner, task.id));

    const profile = await getMemberProfile(owner.id);
    expect(profile!.activity.length).toBeGreaterThanOrEqual(3);
    expect(profile!.activity.every((a) => a.taskArchived)).toBe(true);
  });

  it("is null for an unknown id", async () => {
    expect(await getMemberProfile("nope")).toBeNull();
  });
});

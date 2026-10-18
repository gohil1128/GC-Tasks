import { describe, expect, it } from "vitest";
import {
  createLabelSchema,
  createTaskSchema,
  moveTaskSchema,
  parseInput,
  updateChecklistItemSchema,
  updateLabelSchema,
  updateTaskSchema,
  addCommentSchema,
  addChecklistItemSchema,
  idSchema,
} from "@/modules/tasks/validation";

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.data;
}

function err(result: { ok: boolean; error?: string; code?: string }): string {
  expect(result.ok).toBe(false);
  expect(result.code).toBe("INVALID");
  return result.error ?? "";
}

describe("createTaskSchema", () => {
  it("trims, fills defaults and parses the due day to UTC midnight", () => {
    const data = ok(parseInput(createTaskSchema, { title: "  Order milk  ", dueDate: "2026-10-20" }));
    expect(data).toEqual({
      title: "Order milk",
      description: "",
      status: "TODO",
      priority: "MEDIUM",
      dueDate: new Date("2026-10-20T00:00:00.000Z"),
      assigneeIds: [],
      labelIds: [],
    });
  });

  it("treats a missing, null or empty due date as none", () => {
    expect(ok(parseInput(createTaskSchema, { title: "a" })).dueDate).toBeNull();
    expect(ok(parseInput(createTaskSchema, { title: "a", dueDate: null })).dueDate).toBeNull();
    expect(ok(parseInput(createTaskSchema, { title: "a", dueDate: "" })).dueDate).toBeNull();
  });

  it("rejects a blank or overlong title in words a person can read", () => {
    expect(err(parseInput(createTaskSchema, { title: "   " }))).toBe("Give the task a title.");
    expect(err(parseInput(createTaskSchema, { title: "x".repeat(201) }))).toMatch(/200 characters/);
    expect(ok(parseInput(createTaskSchema, { title: "x".repeat(200) })).title).toHaveLength(200);
  });

  it("rejects an overlong description", () => {
    expect(err(parseInput(createTaskSchema, { title: "a", description: "x".repeat(10_001) }))).toMatch(/10,000/);
  });

  it("rejects days that do not exist and things that are not days", () => {
    expect(err(parseInput(createTaskSchema, { title: "a", dueDate: "2026-02-31" }))).toMatch(/real day/);
    expect(err(parseInput(createTaskSchema, { title: "a", dueDate: "tomorrow" }))).toMatch(/real day/);
  });

  it("rejects an unknown status or priority", () => {
    expect(parseInput(createTaskSchema, { title: "a", status: "BLOCKED" }).ok).toBe(false);
    expect(parseInput(createTaskSchema, { title: "a", priority: "SOMEDAY" }).ok).toBe(false);
  });

  it("de-duplicates id lists and bounds id length", () => {
    const data = ok(parseInput(createTaskSchema, { title: "a", assigneeIds: ["u1", "u1", "u2"] }));
    expect(data.assigneeIds).toEqual(["u1", "u2"]);
    expect(parseInput(createTaskSchema, { title: "a", labelIds: ["x".repeat(65)] }).ok).toBe(false);
    expect(parseInput(createTaskSchema, { title: "a", labelIds: [""] }).ok).toBe(false);
  });

  it("gives a generic line for a wrongly typed field", () => {
    expect(err(parseInput(createTaskSchema, { title: 42 }))).toMatch(/shape/);
    expect(err(parseInput(createTaskSchema, null))).toMatch(/shape/);
  });
});

describe("updateTaskSchema", () => {
  it("keeps absent fields absent and null due date as a clear", () => {
    const data = ok(parseInput(updateTaskSchema, { id: "t1", version: 3, dueDate: null }));
    expect(data).toEqual({ id: "t1", version: 3, dueDate: null });
    expect("title" in data).toBe(false);
  });

  it("needs a whole positive version", () => {
    expect(parseInput(updateTaskSchema, { id: "t1", version: 0 }).ok).toBe(false);
    expect(parseInput(updateTaskSchema, { id: "t1", version: 1.5 }).ok).toBe(false);
    expect(parseInput(updateTaskSchema, { id: "t1" }).ok).toBe(false);
  });
});

describe("moveTaskSchema", () => {
  it("treats missing neighbours as none", () => {
    expect(ok(parseInput(moveTaskSchema, { id: "t1", status: "DONE" }))).toEqual({
      id: "t1",
      status: "DONE",
      afterId: null,
      beforeId: null,
    });
  });

  it("rejects an unknown column", () => {
    expect(parseInput(moveTaskSchema, { id: "t1", status: "ARCHIVED", afterId: null, beforeId: null }).ok).toBe(
      false,
    );
  });
});

describe("checklist and comments", () => {
  it("bounds checklist text at 1-300 after trimming", () => {
    expect(ok(parseInput(addChecklistItemSchema, { taskId: "t", text: "  Milk " })).text).toBe("Milk");
    expect(err(parseInput(addChecklistItemSchema, { taskId: "t", text: "  " }))).toMatch(/some text/);
    expect(parseInput(addChecklistItemSchema, { taskId: "t", text: "x".repeat(301) }).ok).toBe(false);
  });

  it("needs something to change on a checklist item", () => {
    expect(err(parseInput(updateChecklistItemSchema, { id: "c1" }))).toBe("There is nothing to change.");
    expect(ok(parseInput(updateChecklistItemSchema, { id: "c1", done: false })).done).toBe(false);
  });

  it("bounds comments at 1-5000 after trimming", () => {
    expect(err(parseInput(addCommentSchema, { taskId: "t", body: "\n\n" }))).toMatch(/Write something/);
    expect(parseInput(addCommentSchema, { taskId: "t", body: "x".repeat(5_001) }).ok).toBe(false);
    expect(ok(parseInput(addCommentSchema, { taskId: "t", body: "x".repeat(5_000) })).body).toHaveLength(5_000);
  });
});

describe("labels", () => {
  it("trims names and only accepts colour keys from the palette", () => {
    expect(ok(parseInput(createLabelSchema, { name: " Kitchen ", color: "teal" }))).toEqual({
      name: "Kitchen",
      color: "teal",
    });
    expect(err(parseInput(createLabelSchema, { name: "Kitchen", color: "#ff0000" }))).toMatch(/colours/);
    expect(err(parseInput(createLabelSchema, { name: "", color: "teal" }))).toMatch(/name/);
    expect(parseInput(createLabelSchema, { name: "x".repeat(81), color: "teal" }).ok).toBe(false);
  });

  it("lets an update change just one thing", () => {
    expect(ok(parseInput(updateLabelSchema, { id: "l1", color: "plum" }))).toEqual({ id: "l1", color: "plum" });
  });
});

describe("idSchema", () => {
  it("accepts 1-64 characters", () => {
    expect(parseInput(idSchema, "c".repeat(64)).ok).toBe(true);
    expect(parseInput(idSchema, "").ok).toBe(false);
    expect(parseInput(idSchema, "c".repeat(65)).ok).toBe(false);
    expect(parseInput(idSchema, 7).ok).toBe(false);
  });
});

describe("hidden characters", () => {
  // Postgres text cannot store U+0000; let through, it fails the write itself.
  const NUL = "\u0000";

  it("refuses a NUL anywhere a string reaches the database, in words a person can read", () => {
    const message = "That contains a hidden character that can't be saved. Retype it and try again.";
    expect(err(parseInput(createTaskSchema, { title: `Milk${NUL}run` }))).toBe(message);
    expect(err(parseInput(createTaskSchema, { title: "Milk run", description: `a${NUL}` }))).toBe(message);
    expect(err(parseInput(addCommentSchema, { taskId: "t1", body: `a${NUL}b` }))).toBe(message);
    expect(err(parseInput(addChecklistItemSchema, { taskId: "t1", text: `a${NUL}` }))).toBe(message);
    expect(err(parseInput(createLabelSchema, { name: `K${NUL}`, color: "teal" }))).toBe(message);
    expect(idSchema.safeParse(`id${NUL}`).success).toBe(false);
  });

  it("leaves ordinary text alone", () => {
    expect(ok(parseInput(addCommentSchema, { taskId: "t1", body: "Order milk — 2× oat" })).body).toBe(
      "Order milk — 2× oat",
    );
  });
});

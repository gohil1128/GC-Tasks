import { describe, expect, it } from "vitest";
import { describeActivity, joinNames } from "@/modules/tasks/activity";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";

const NAMES: Record<string, string> = { u1: "Harsh", u2: "Riya", u3: "Sam" };
const nameOf = (id: string) => NAMES[id] ?? "Someone";

function act(type: ActivityType | string, detail: Record<string, unknown> = {}, actorId = "u1"): ActivityDTO {
  return {
    id: "a1",
    actorId,
    type: type as ActivityType,
    detail,
    createdAt: "2026-10-17T09:30:00.000Z",
  };
}

const say = (type: ActivityType | string, detail?: Record<string, unknown>, actorId?: string) =>
  describeActivity(act(type, detail, actorId), nameOf);

describe("describeActivity", () => {
  it("creation, archiving and comments", () => {
    expect(say("created")).toBe("created this task");
    expect(say("archived")).toBe("archived this task");
    expect(say("restored")).toBe("restored this task");
    expect(say("commented")).toBe("commented");
  });

  it("moves between columns", () => {
    expect(say("moved", { from: "TODO", to: "IN_PROGRESS" })).toBe("moved this from To do to In progress");
    expect(say("moved", { from: "IN_PROGRESS", to: "DONE" })).toBe("moved this from In progress to Done");
    expect(say("moved", { to: "DONE" })).toBe("moved this to Done");
    expect(say("moved", { from: "nope", to: 7 })).toBe("moved this");
  });

  it("edits", () => {
    expect(say("edited", { fields: ["title"] })).toBe("edited the title");
    expect(say("edited", { fields: ["title", "description"] })).toBe("edited the title and description");
    expect(say("edited", {})).toBe("edited this task");
  });

  it("people", () => {
    expect(say("assigned", { userIds: ["u2"] })).toBe("assigned Riya");
    expect(say("assigned", { userIds: ["u2", "u3"] })).toBe("assigned Riya and Sam");
    expect(say("assigned", { userIds: ["u1"] })).toBe("picked this up");
    expect(say("assigned", { userIds: ["u1", "u2"] })).toBe("assigned themselves and Riya");
    expect(say("unassigned", { userIds: ["u3"] })).toBe("unassigned Sam");
    expect(say("unassigned", { userIds: ["u1"] })).toBe("stepped off this task");
    expect(say("assigned", { userIds: ["u9"] })).toBe("assigned Someone");
  });

  it("labels, by name", () => {
    expect(say("labels_changed", { added: ["Kitchen"], removed: [] })).toBe("added the Kitchen label");
    expect(say("labels_changed", { added: ["Kitchen", "Bar"], removed: [] })).toBe("added the Kitchen and Bar labels");
    expect(say("labels_changed", { added: [], removed: ["Marketing"] })).toBe("removed the Marketing label");
    expect(say("labels_changed", { added: ["Kitchen"], removed: ["Marketing"] })).toBe(
      "added the Kitchen label and removed the Marketing label",
    );
    expect(say("labels_changed", {})).toBe("changed the labels");
  });

  it("due dates, without the year when it is the year of the change", () => {
    expect(say("due_changed", { from: "2026-10-18", to: "2026-10-20" })).toBe("changed the due date to Oct 20");
    expect(say("due_changed", { from: null, to: "2026-10-20" })).toBe("set the due date to Oct 20");
    expect(say("due_changed", { from: "2026-10-20", to: null })).toBe("removed the due date");
    expect(say("due_changed", { from: null, to: "2027-01-05" })).toBe("set the due date to Jan 5, 2027");
  });

  it("priority", () => {
    expect(say("priority_changed", { from: "MEDIUM", to: "URGENT" })).toBe(
      "changed the priority from Medium to Urgent",
    );
    expect(say("priority_changed", { to: "LOW" })).toBe("set the priority to Low");
    expect(say("priority_changed", {})).toBe("changed the priority");
  });

  it("checklist items, quoted", () => {
    expect(say("checklist_added", { text: "Order milk" })).toBe("added “Order milk” to the checklist");
    expect(say("checklist_checked", { text: "Order milk" })).toBe("checked “Order milk”");
    expect(say("checklist_unchecked", { text: "Order milk" })).toBe("unchecked “Order milk”");
    expect(say("checklist_removed", { text: "Order milk" })).toBe("removed “Order milk” from the checklist");
    expect(say("checklist_checked", {})).toBe("checked an item");
  });

  it("something it does not know", () => {
    expect(say("teleported")).toBe("updated this task");
  });
});

describe("joinNames", () => {
  it("reads like a sentence", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Riya"])).toBe("Riya");
    expect(joinNames(["Riya", "Sam"])).toBe("Riya and Sam");
    expect(joinNames(["Riya", "Sam", "Ali"])).toBe("Riya, Sam and Ali");
  });
});

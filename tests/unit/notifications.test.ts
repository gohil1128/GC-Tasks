import { describe, expect, it } from "vitest";
import {
  notificationSentence,
  notificationText,
  pickPushEntry,
} from "@/modules/notifications/text";
import type { PendingActivity } from "@/modules/notifications/context";
import type { ActivityDTO, ActivityType } from "@/modules/tasks/types";

const NAMES: Record<string, string> = { u1: "Harsh", u2: "Riya" };
const nameOf = (id: string) => NAMES[id] ?? "Someone";

function dto(type: ActivityType, detail: Record<string, unknown> = {}): ActivityDTO {
  return { id: "a1", actorId: "u2", type, detail, createdAt: "2026-10-20T09:30:00.000Z" };
}

function pending(type: ActivityType, detail: Record<string, unknown> = {}): PendingActivity {
  return { taskId: "t1", actorId: "u2", type, detail };
}

describe("notificationSentence", () => {
  it("calls a move into Done a completion", () => {
    expect(notificationSentence(dto("moved", { from: "IN_PROGRESS", to: "DONE" }), nameOf)).toBe(
      "completed this task",
    );
    expect(notificationSentence(dto("moved", { to: "DONE" }), nameOf)).toBe("completed this task");
  });

  it("leaves other moves in the history wording", () => {
    expect(notificationSentence(dto("moved", { from: "TODO", to: "IN_PROGRESS" }), nameOf)).toBe(
      "moved this from To do to In progress",
    );
    expect(notificationSentence(dto("created"), nameOf)).toBe("created this task");
    expect(notificationSentence(dto("commented"), nameOf)).toBe("commented");
  });
});

describe("notificationText", () => {
  it("reads as actor + sentence + task title", () => {
    expect(notificationText("Riya", dto("moved", { to: "DONE" }), "Order cups", nameOf)).toBe(
      "Riya completed this task — Order cups",
    );
    expect(notificationText("Riya", dto("created"), "Order cups", nameOf)).toBe(
      "Riya created this task — Order cups",
    );
  });
});

describe("pickPushEntry", () => {
  it("one save, one push: the most newsworthy entry wins", () => {
    const picked = pickPushEntry([
      pending("edited", { fields: ["title"] }),
      pending("assigned", { userIds: ["u1"] }),
      pending("due_changed", { to: "2026-10-25" }),
    ]);
    expect(picked.type).toBe("assigned");
  });

  it("a completion outranks a plain assignment in the same write", () => {
    const picked = pickPushEntry([
      pending("assigned", { userIds: ["u2"] }),
      pending("moved", { from: "IN_PROGRESS", to: "DONE" }),
    ]);
    expect(picked.type).toBe("moved");
  });

  it("creation outranks everything else in its write", () => {
    const picked = pickPushEntry([pending("moved", { to: "DONE" }), pending("created")]);
    expect(picked.type).toBe("created");
  });
});

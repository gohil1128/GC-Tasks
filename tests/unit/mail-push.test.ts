import { describe, expect, it } from "vitest";
import { activityPushMuted, withoutActivityPush } from "@/modules/notifications/context";
import { emailTaskPayload } from "@/modules/notifications/dispatch";

describe("the push for a task logged from email", () => {
  it("names the task and opens it", () => {
    expect(emailTaskPayload({ taskId: "t1", title: "Sign the LOA from Hydro", kind: "task", doubtful: false })).toEqual({
      body: "New task from email: Sign the LOA from Hydro",
      tag: "email-t1",
      url: "/?task=t1",
    });
  });

  it("says when it is a follow-up, and when the email needs checking", () => {
    expect(emailTaskPayload({ taskId: "t1", title: "Sign the LOA", kind: "update", doubtful: true }).body).toBe(
      "Email update on (check it's genuine): Sign the LOA",
    );
  });
});

describe("muting the ordinary activity push", () => {
  it("holds for everything inside, across awaits, and nowhere else", async () => {
    expect(activityPushMuted()).toBe(false);
    const inside = await withoutActivityPush(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return activityPushMuted();
    });
    expect(inside).toBe(true);
    expect(activityPushMuted()).toBe(false);
  });
});

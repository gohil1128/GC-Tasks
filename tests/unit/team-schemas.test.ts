import { describe, expect, it } from "vitest";
import { addMemberSchema, emailSchema, firstIssue, nameSchema, profileSchema } from "@/modules/team/schemas";

const NAME_HAS_NUL = "That name contains a hidden character that can't be saved. Retype it and try again.";

describe("team input schemas", () => {
  it("trims and lowercases emails so one address is one account", () => {
    expect(emailSchema.parse("  Ravi@Example.COM ")).toBe("ravi@example.com");
  });

  it("rejects a malformed or empty email with a readable message", () => {
    const bad = emailSchema.safeParse("ravi@");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(firstIssue(bad.error)).toBe("Enter a valid email address.");
    const empty = emailSchema.safeParse("   ");
    expect(!empty.success && firstIssue(empty.error)).toBe("Enter an email address.");
  });

  it("trims names and bounds them to 1–80 characters", () => {
    expect(addMemberSchema.parse({ name: "  Meera  ", email: "m@example.com", role: "STAFF" }).name).toBe("Meera");
    expect(addMemberSchema.safeParse({ name: "   ", email: "m@example.com", role: "STAFF" }).success).toBe(false);
    expect(addMemberSchema.safeParse({ name: "x".repeat(80), email: "m@example.com", role: "STAFF" }).success).toBe(
      true,
    );
    expect(addMemberSchema.safeParse({ name: "x".repeat(81), email: "m@example.com", role: "STAFF" }).success).toBe(
      false,
    );
  });

  it("refuses a name with a NUL character, which the database cannot store", () => {
    for (const name of ["Sam\u0000", "\u0000", "Sa\u0000m Staff"]) {
      const bad = nameSchema.safeParse(name);
      expect(bad.success).toBe(false);
      if (!bad.success) expect(firstIssue(bad.error)).toBe(NAME_HAS_NUL);
    }
    expect(profileSchema.safeParse({ name: "Sam\u0000", color: "teal" }).success).toBe(false);
  });

  it("accepts only the two roles", () => {
    expect(addMemberSchema.safeParse({ name: "M", email: "m@example.com", role: "OWNER" }).success).toBe(true);
    const bad = addMemberSchema.safeParse({ name: "M", email: "m@example.com", role: "ADMIN" });
    expect(!bad.success && firstIssue(bad.error)).toBe("Choose Owner or Staff.");
  });

  it("accepts only known colour keys for a profile", () => {
    expect(profileSchema.safeParse({ name: "M", color: "teal" }).success).toBe(true);
    for (const color of ["#ff0000", "Teal", "", "red"]) {
      expect(profileSchema.safeParse({ name: "M", color }).success).toBe(false);
    }
  });

  it("ignores unknown keys rather than passing them through", () => {
    const parsed = profileSchema.parse({ name: "M", color: "teal", role: "OWNER" });
    expect(parsed).toEqual({ name: "M", color: "teal" });
  });
});

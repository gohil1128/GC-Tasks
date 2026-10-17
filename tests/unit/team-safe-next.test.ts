import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNextPath } from "@/modules/auth/safe-next";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query and hash", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/team")).toBe("/team");
    expect(safeNextPath("/settings?tab=labels#top")).toBe("/settings?tab=labels#top");
    expect(safeNextPath("/change-password")).toBe("/change-password");
  });

  it("falls back to the board for anything that is not a string path", () => {
    for (const value of [undefined, null, 42, {}, ["/team"], "", "team", "settings/labels"]) {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT);
    }
  });

  it("refuses absolute and protocol-relative URLs", () => {
    for (const value of [
      "https://evil.example",
      "http://evil.example/team",
      "//evil.example",
      "//evil.example/team",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT);
    }
  });

  it("refuses the backslash and whitespace tricks browsers turn into another site", () => {
    for (const value of ["/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/\n/evil.example", "/x\\y"]) {
      expect(safeNextPath(value)).toBe(DEFAULT_NEXT);
    }
  });

  it("checks the path again after resolving dot segments", () => {
    expect(safeNextPath("/..//evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/./team")).toBe("/team");
    expect(safeNextPath("/a/../team")).toBe("/team");
  });

  it("leaves encoded slashes encoded, which keeps them on this site", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  it("does not send someone back to sign-in or setup", () => {
    expect(safeNextPath("/login")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/login?next=/team")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/setup")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/login-help")).toBe("/login-help");
  });

  it("refuses absurdly long values", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe(DEFAULT_NEXT);
  });
});

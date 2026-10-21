import { describe, expect, it } from "vitest";
import { splitLinks } from "@/lib/linkify";

describe("splitLinks", () => {
  it("leaves plain text as one part", () => {
    expect(splitLinks("Order more cardamom")).toEqual([{ text: "Order more cardamom" }]);
    expect(splitLinks("")).toEqual([{ text: "" }]);
  });

  it("linkifies an https URL in the middle of a sentence", () => {
    expect(splitLinks("See https://example.com/menu for prices")).toEqual([
      { text: "See " },
      { text: "https://example.com/menu", href: "https://example.com/menu" },
      { text: " for prices" },
    ]);
  });

  it("keeps trailing sentence punctuation out of the link", () => {
    expect(splitLinks("It is here: https://example.com/a.")).toEqual([
      { text: "It is here: " },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: "." },
    ]);
    expect(splitLinks("(see https://example.com/a)")).toEqual([
      { text: "(see " },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: ")" },
    ]);
  });

  it("keeps balanced brackets inside a URL", () => {
    const url = "https://en.wikipedia.org/wiki/Chai_(tea)";
    expect(splitLinks(url)).toEqual([{ text: url, href: url }]);
  });

  it("upgrades a bare www. host to https", () => {
    expect(splitLinks("www.supplier.ca/order")).toEqual([
      { text: "www.supplier.ca/order", href: "https://www.supplier.ca/order" },
    ]);
  });

  it("handles several links and line breaks", () => {
    const parts = splitLinks("One https://a.co/1\nTwo https://b.co/2 end");
    expect(parts.filter((p) => p.href)).toHaveLength(2);
    expect(parts.map((p) => p.text).join("")).toBe("One https://a.co/1\nTwo https://b.co/2 end");
  });

  it("never linkifies other schemes or bare domains", () => {
    expect(splitLinks("javascript:alert(1)")).toEqual([{ text: "javascript:alert(1)" }]);
    expect(splitLinks("visit example.com sometime")).toEqual([{ text: "visit example.com sometime" }]);
    expect(splitLinks("mail me at a@example.com")).toEqual([{ text: "mail me at a@example.com" }]);
  });
});

import { describe, expect, it } from "vitest";
import { buildScanQuery, htmlToText, isAuthenticated, parseFrom, parseMessage } from "@/modules/mail/gmail";

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const h = (name: string, value: string) => ({ name, value });

describe("parseFrom", () => {
  it("splits a display name from the address", () => {
    expect(parseFrom('"Ravi Tent" <Billing@RaviTent.ca>')).toEqual({ name: "Ravi Tent", address: "billing@ravitent.ca" });
    expect(parseFrom("Ravi Tent <billing@ravitent.ca>")).toEqual({ name: "Ravi Tent", address: "billing@ravitent.ca" });
  });
  it("takes a bare address", () => {
    expect(parseFrom("Billing@Ravi.ca")).toEqual({ name: "", address: "billing@ravi.ca" });
  });
  it("does not let a display name pose as the address", () => {
    // The part that is trusted is what is inside the angle brackets.
    expect(parseFrom('"billing@clover.com" <spoof@evil.ru>').address).toBe("spoof@evil.ru");
  });
});

describe("htmlToText", () => {
  it("drops tags, scripts and styles, keeps the figures and the line breaks", () => {
    const t = htmlToText("<style>p{x:y}</style><p>Total</p><table><tr><td>Due</td><td>$260.00</td></tr></table><script>alert(1)</script>");
    expect(t).toContain("Total");
    expect(t).toContain("$260.00");
    expect(t).not.toMatch(/alert|p\{x/);
  });
  it("decodes the common entities", () => {
    expect(htmlToText("Fish &amp; Chips &lt;b&gt; &quot;hi&quot;")).toBe('Fish & Chips <b> "hi"');
  });
});

describe("parseMessage", () => {
  const raw = {
    id: "m1", threadId: "t1", internalDate: String(Date.parse("2026-11-01T18:30:00Z")),
    payload: {
      mimeType: "multipart/mixed",
      headers: [h("From", '"Ravi Tent" <billing@ravitent.ca>'), h("Subject", " Invoice 3310 ")],
      parts: [
        { mimeType: "multipart/alternative", parts: [
          { mimeType: "text/plain", body: { data: b64("Total due $260.00") } },
          { mimeType: "text/html", body: { data: b64("<p>HTML version</p>") } },
        ] },
        { mimeType: "application/pdf", filename: "INV-3310.pdf", body: { attachmentId: "a1", size: 48_000 } },
        { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "a2", size: 900 } },
        { mimeType: "application/zip", filename: "bundle.zip", body: { attachmentId: "a3", size: 90_000 } },
        { mimeType: "image/jpeg", filename: "scan.jpg", body: { attachmentId: "a4", size: 300_000 } },
      ],
    },
  };

  it("reads sender, subject, date and prefers the plain-text body", () => {
    const m = parseMessage(raw);
    expect(m).toMatchObject({ id: "m1", fromAddress: "billing@ravitent.ca", fromName: "Ravi Tent", subject: "Invoice 3310" });
    expect(m.receivedAt.toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(m.text).toBe("Total due $260.00");
  });

  it("keeps only attachments a model can read, and drops logos and tracking pixels", () => {
    expect(parseMessage(raw).attachments.map((a) => a.filename)).toEqual(["INV-3310.pdf", "scan.jpg"]);
  });

  it("falls back to the HTML body when there is no plain text", () => {
    const m = parseMessage({ ...raw, payload: { headers: raw.payload.headers, mimeType: "text/html", body: { data: b64("<p>Amount due <b>$12.00</b></p>") } } });
    expect(m.text).toContain("$12.00");
  });
});

describe("the Gmail search", () => {
  const q = buildScanQuery(new Date("2026-11-01T00:00:00Z"));
  it("starts from the cursor, in epoch seconds", () => {
    expect(q).toContain(`after:${Date.parse("2026-11-01T00:00:00Z") / 1000}`);
  });
  it("leaves out what Gmail has already filed as noise, and mail the account sent", () => {
    for (const x of ["-category:promotions", "-category:social", "-category:forums", "-in:spam", "-in:trash", "-in:sent", "-from:me"]) {
      expect(q).toContain(x);
    }
  });
  it("does not narrow by keyword: an ask to sign or fill something has no word in common", () => {
    expect(q).not.toMatch(/invoice|has:attachment/);
  });
});

describe("isAuthenticated — was it really sent by who it says?", () => {
  const AUTH = (rest: string) => `mx.google.com; ${rest}`;
  const dmarc = AUTH("dkim=pass header.i=@ravitent.ca header.s=s1; spf=pass smtp.mailfrom=bounce@mail.ravitent.ca; dmarc=pass (p=REJECT) header.from=ravitent.ca");

  it("accepts a DMARC pass", () => {
    expect(isAuthenticated(dmarc, "billing@ravitent.ca")).toBe(true);
  });

  it("accepts a DKIM pass signed by the SAME domain when there is no DMARC policy", () => {
    expect(isAuthenticated(AUTH("dkim=pass header.i=@ravitent.ca; spf=neutral; dmarc=none"), "billing@ravitent.ca")).toBe(true);
    expect(isAuthenticated(AUTH("dkim=pass header.d=mail.ravitent.ca; dmarc=none"), "billing@ravitent.ca")).toBe(true);
  });

  it("does NOT accept a DKIM pass for an unrelated domain — anyone can sign as themselves", () => {
    expect(isAuthenticated(AUTH("dkim=pass header.i=@evil.ru header.d=evil.ru; spf=pass; dmarc=none"), "billing@ravitent.ca")).toBe(false);
  });

  it("does not accept a lookalike domain as aligned", () => {
    expect(isAuthenticated(AUTH("dkim=pass header.d=notravitent.ca; dmarc=none"), "billing@ravitent.ca")).toBe(false);
  });

  it("does not accept SPF alone", () => {
    expect(isAuthenticated(AUTH("spf=pass smtp.mailfrom=billing@ravitent.ca; dkim=none; dmarc=none"), "billing@ravitent.ca")).toBe(false);
  });

  it("rejects fail, softfail, none and a missing header", () => {
    expect(isAuthenticated(AUTH("dkim=fail header.i=@ravitent.ca; spf=softfail; dmarc=fail"), "billing@ravitent.ca")).toBe(false);
    expect(isAuthenticated(AUTH("dkim=none; spf=none; dmarc=none"), "billing@ravitent.ca")).toBe(false);
    expect(isAuthenticated(undefined, "billing@ravitent.ca")).toBe(false);
    expect(isAuthenticated("", "billing@ravitent.ca")).toBe(false);
  });

  it("ignores a verdict that was not written by Gmail", () => {
    expect(isAuthenticated("mail.evil.ru; dmarc=pass header.from=ravitent.ca", "billing@ravitent.ca")).toBe(false);
  });

  it("reads only the top header, so a forged one inside the message cannot win", () => {
    const headers = [
      h("From", "Ravi <billing@ravitent.ca>"),
      h("Authentication-Results", AUTH("dkim=none; spf=fail; dmarc=fail")),            // Gmail's own, on top
      h("Authentication-Results", "mx.google.com; dmarc=pass header.from=ravitent.ca"), // the sender's forgery, below
    ];
    const m = parseMessage({ id: "x", threadId: "x", internalDate: "1", payload: { headers, mimeType: "text/plain", body: { data: Buffer.from("hi").toString("base64url") } } });
    expect(m.authenticated).toBe(false);
  });

  it("flows through parseMessage when the top header passes", () => {
    const m = parseMessage({ id: "x", threadId: "x", internalDate: "1", payload: { headers: [h("From", "billing@ravitent.ca"), h("Authentication-Results", dmarc)], mimeType: "text/plain", body: { data: Buffer.from("hi").toString("base64url") } } });
    expect(m.authenticated).toBe(true);
  });
});

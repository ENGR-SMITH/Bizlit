import { describe, expect, it } from "vitest";
import {
  composeClientUpdate,
  nextSendAt,
  subjectFor as gatewaySubjectFor,
} from "../supabase/functions/_shared/mail";
import {
  dotStuff,
  encodeMessage,
  SmtpError,
  smtpSession,
  type SmtpReply,
  type SmtpTransport,
} from "../supabase/functions/_shared/smtp";
import { subjectFor as appSubjectFor, type MessageType } from "../src/lib/options";

/**
 * The two halves of mail delivery that can be checked without a server: what
 * goes on the wire (`encodeMessage`, `smtpSession`, `dotStuff`) and what the
 * desk says (`composeClientUpdate`, and the subject the schedule tab previews).
 *
 * The session is driven through a scripted transport, so the protocol — EHLO,
 * STARTTLS, AUTH LOGIN, the envelope, DATA framing — is the real code path with
 * only the socket replaced.
 */

type Scripted = number | string | SmtpReply;

function replyOf(entry: Scripted): SmtpReply {
  if (typeof entry === "number") return { code: entry, text: `${entry} ready` };
  if (typeof entry === "string") return { code: Number(entry.slice(0, 3)), text: entry };
  return entry;
}

class ScriptedTransport implements SmtpTransport {
  readonly written: string[] = [];
  private readonly replies: SmtpReply[];

  constructor(replies: Scripted[]) {
    this.replies = replies.map(replyOf);
  }

  async read(): Promise<SmtpReply> {
    const next = this.replies.shift();
    if (!next) throw new Error("the script ran out of replies");
    return next;
  }

  async write(chunk: string): Promise<void> {
    this.written.push(chunk);
  }

  async close(): Promise<void> {}

  get transcript(): string {
    return this.written.join("");
  }
}

/** A complete, well-behaved conversation: greet, EHLO, auth, envelope, data, quit. */
function happyReplies(): Scripted[] {
  return [
    "220 mail.spacemail.com ESMTP ready",
    { code: 250, text: "250-mx.example.com\n250-AUTH LOGIN PLAIN\n250 SIZE 71000000" },
    "334 VXNlcm5hbWU6",
    "334 UGFzc3dvcmQ6",
    "235 2.7.0 Authentication successful",
    "250 2.1.0 Ok",
    "250 2.1.5 Ok",
    "354 End data with <CR><LF>.<CR><LF>",
    "250 2.0.0 Ok: queued as ABC123",
    "221 2.0.0 Bye",
  ];
}

const SESSION = {
  hostname: "mail.spacemail.com",
  user: "no-reply@example.com",
  password: "hunter2",
  mailFrom: "no-reply@example.com",
  rcptTo: ["customer@example.com"],
  data: "Date: Fri, 02 Oct 2026 10:00:00 +0000\r\n\r\nhello\r\n",
};

describe("smtpSession", () => {
  it("greets, authenticates, sends the envelope and frames DATA", async () => {
    const transport = new ScriptedTransport(happyReplies());

    await smtpSession(transport, SESSION);

    expect(transport.transcript).toContain("EHLO mail.spacemail.com");
    expect(transport.transcript).toContain(
      `AUTH LOGIN\r\n${btoa("no-reply@example.com")}\r\n${btoa("hunter2")}\r\n`,
    );
    expect(transport.transcript).toContain("MAIL FROM:<no-reply@example.com>\r\n");
    expect(transport.transcript).toContain("RCPT TO:<customer@example.com>\r\n");
    expect(transport.transcript).toContain("DATA\r\n");
    // The message, then the terminating dot on its own line.
    expect(transport.transcript).toContain("hello\r\n.\r\n");
    expect(transport.transcript).toContain("QUIT\r\n");
  });

  it("reports a rejected password as a credentials problem", async () => {
    const transport = new ScriptedTransport([
      "220 ready",
      "250-AUTH LOGIN\n250 HELP",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "535 5.7.8 Error: authentication failed",
    ]);

    await expect(smtpSession(transport, SESSION)).rejects.toThrowError(
      /SMTP username or password/i,
    );
  });

  it("upgrades with STARTTLS when the connection started in plaintext", async () => {
    const transport = new ScriptedTransport([
      "220 ready",
      { code: 250, text: "250-STARTTLS\n250 HELP" },
      "220 Ready to start TLS",
      { code: 250, text: "250-AUTH LOGIN\n250 SIZE" },
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 ok",
      "250 ok",
      "250 ok",
      "354 go ahead",
      "250 queued",
      "221 bye",
    ]);
    let upgraded = 0;

    await smtpSession(transport, {
      ...SESSION,
      starttls: async () => {
        upgraded += 1;
        return transport;
      },
    });

    expect(upgraded).toBe(1);
    expect(transport.transcript).toContain("STARTTLS\r\n");
    // EHLO is repeated after the upgrade — the capabilities are only valid in
    // the connection they were announced on.
    expect(transport.transcript.match(/EHLO mail\.spacemail\.com/g)).toHaveLength(2);
  });

  it("refuses to send in plaintext when the server offers no STARTTLS", async () => {
    const transport = new ScriptedTransport(["220 ready", "250-AUTH LOGIN\n250 HELP"]);

    await expect(
      smtpSession(transport, { ...SESSION, starttls: async () => transport }),
    ).rejects.toThrowError(/does not offer STARTTLS/);
  });

  it("surfaces a refused recipient with the server's own words", async () => {
    const transport = new ScriptedTransport([
      "220 ready",
      "250-AUTH LOGIN\n250 HELP",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 ok",
      "250 ok",
      "550 5.1.1 recipient address rejected",
    ]);

    const failure = smtpSession(transport, SESSION);
    await expect(failure).rejects.toBeInstanceOf(SmtpError);
    await expect(failure).rejects.toThrowError(/refused an address/);
  });
});

describe("encodeMessage", () => {
  const base = {
    from: "BIZLIT <no-reply@example.com>",
    to: "Ada <ada@example.com>",
    subject: "Live deals you can promote today",
  };

  it("writes the headers and both alternatives", () => {
    const message = encodeMessage(
      { ...base, text: "plain body", html: "<p>Hi</p>" },
      { date: new Date("2026-10-02T10:00:00Z"), messageId: "abc@example.com" },
    );

    expect(message).toContain("From: BIZLIT <no-reply@example.com>");
    expect(message).toContain("To: Ada <ada@example.com>");
    expect(message).toContain("Subject: Live deals you can promote today");
    expect(message).toContain("Message-ID: <abc@example.com>");
    expect(message).toContain("Date: Fri, 02 Oct 2026 10:00:00 +0000");
    expect(message).toContain('Content-Type: multipart/alternative; boundary="');
    expect(message).toContain("Content-Transfer-Encoding: base64");
  });

  it("base64s the text part so the body survives the journey", () => {
    const message = encodeMessage({ ...base, text: "line one\n.line two" });
    const match = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n$/.exec(message);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match![1].replace(/\r\n/g, ""), "base64").toString("utf8");
    expect(decoded).toBe("line one\n.line two");
  });

  it("encodes a subject that is not plain ASCII", () => {
    const message = encodeMessage({ ...base, subject: "Deals — 20% off today" });
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).not.toContain("Deals —");
  });

  it("strips line breaks so a subject cannot inject a header", () => {
    const message = encodeMessage({ ...base, subject: "Hi\nBcc: evil@example.com" });
    expect(message).not.toMatch(/\r\nBcc:/);
    expect(message).toContain("Subject: Hi Bcc: evil@example.com");
  });

  it("carries a reply-to only when one was given", () => {
    expect(encodeMessage({ ...base, text: "x" })).not.toContain("Reply-To:");
    expect(encodeMessage({ ...base, text: "x", replyTo: "hello@glowmart.example" })).toContain(
      "Reply-To: hello@glowmart.example",
    );
  });
});

describe("dotStuff", () => {
  it("stuffs a line that begins with a dot", () => {
    expect(dotStuff("first\r\n.hidden\r\nlast")).toBe("first\r\n..hidden\r\nlast");
  });

  it("leaves ordinary content alone and normalises line endings", () => {
    expect(dotStuff("one\ntwo")).toBe("one\r\ntwo");
    expect(dotStuff("no dots")).toBe("no dots");
  });
});

describe("the update the desk writes", () => {
  const recipients = {
    from: "BIZLIT <no-reply@example.com>",
    to: "ada@example.com",
    clientName: "Ada Lovelace",
    company: "GlowMart Beauty",
    senderName: "Aurora",
    brandName: "GlowMart Beauty",
    signature: "Stay sharp,\nAurora",
  };

  it("matches the subject the schedule tab previews, for every type", () => {
    const types: MessageType[] = [
      "new_stock",
      "two_day_checkin",
      "platform_info",
      "deals",
      "competitor_alert",
      "review_update",
      "weekly_report",
    ];
    for (const type of types) {
      expect(gatewaySubjectFor("GlowMart Beauty", [type])).toBe(
        appSubjectFor("GlowMart Beauty", [type]),
      );
    }
    // No types at all falls back to the weekly report on both sides.
    expect(gatewaySubjectFor("GlowMart Beauty", [])).toBe(
      appSubjectFor("GlowMart Beauty", []),
    );
  });

  it("names the subscribed updates and signs the message", () => {
    const mail = composeClientUpdate({ ...recipients, types: ["deals", "new_stock"] });

    expect(mail.subject).toBe("Live deals you can promote today");
    expect(mail.text).toContain("• Deals —");
    expect(mail.text).toContain("• New stock —");
    expect(mail.text).toContain("Stay sharp,");
    expect(mail.html).toContain("Live competitor and platform deals worth buying");
    expect(mail.html).toContain("GlowMart Beauty");
    // A subscribed list with no types still mails the weekly report rather
    // than an empty body.
    expect(composeClientUpdate({ ...recipients, types: [] }).subject).toBe(
      "Your weekly market watch report",
    );
  });

  it("escapes anything the workspace typed before it reaches HTML", () => {
    const mail = composeClientUpdate({
      ...recipients,
      clientName: "<script>alert(1)</script>",
      company: "Glow & Co",
      types: ["deals"],
    });

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Glow &amp; Co");
    expect(mail.text).toContain("Glow & Co");
  });
});

describe("nextSendAt", () => {
  const from = new Date("2026-10-02T10:00:00Z");

  it("pulls an urgent type forward so a stock alert is not held for a week", () => {
    const weekly = new Date(nextSendAt("weekly", [], from)).getTime();
    const urgent = new Date(nextSendAt("weekly", ["new_stock"], from)).getTime();
    const days = (urgent - from.getTime()) / 86_400_000;

    expect(urgent).toBeLessThan(weekly);
    expect(days).toBeGreaterThan(1);
    expect(days).toBeLessThan(2.5);
  });

  it("keeps the cadence for everything else", () => {
    const weekly = new Date(nextSendAt("weekly", ["deals"], from)).getTime();
    const monthly = new Date(nextSendAt("monthly", ["deals"], from)).getTime();

    expect(monthly).toBeGreaterThan(weekly);
    expect((weekly - from.getTime()) / 86_400_000).toBeGreaterThan(6);
  });
});

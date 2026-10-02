import { getEnv } from "./env.ts";

/**
 * SMTP delivery for the client mail desk.
 *
 * The desk posts through Spacemail (`mail.spacemail.com`, port 465, implicit
 * TLS, AUTH LOGIN with the mailbox credentials) because that is this
 * workspace's mailbox — but nothing below names that provider: host, port,
 * security mode and credentials all come from the `EMAIL_SMTP_*` secrets, so
 * repointing the desk at another SMTP server is a secrets change, not a code
 * change.
 *
 * Hand-rolled rather than an npm client for two reasons: the gateway runs on
 * Deno's edge runtime, where an npm SMTP package is not guaranteed to run; and
 * the slice of SMTP this app needs — one message per call, AUTH LOGIN, no
 * pipelining — is small enough to hold in one file where it can be read and
 * tested. The session driver (`smtpSession`) is deliberately separated from the
 * socket (`DenoTransport`), so tests can run the real protocol logic against a
 * scripted transport without opening a connection.
 */

/** How the desk connects, and as whom. Read from the environment, never committed. */
export interface SmtpSettings {
  host: string;
  port: number;
  /** True = TLS from the first byte (port 465). False = plain, upgraded with STARTTLS when offered. */
  secure: boolean;
  user: string;
  password: string;
  /** From header, e.g. `BIZLIT <no-reply@example.com>`. */
  from: string;
  replyTo?: string;
}

/**
 * The SMTP configuration, or null when it is incomplete.
 *
 * Blank means "not configured on this deployment" — the same convention the
 * other providers use, so the gateway can refuse with a message that names the
 * missing variables instead of attempting a connection it cannot make.
 */
export function smtpSettings(): SmtpSettings | null {
  const host = getEnv("EMAIL_SMTP_HOST");
  const user = getEnv("EMAIL_SMTP_USER");
  const password = getEnv("EMAIL_SMTP_PASS");
  const from = getEnv("EMAIL_FROM");
  if (!host || !user || !password || !from) return null;

  const port = Number(getEnv("EMAIL_SMTP_PORT") ?? "") || 465;
  const secureFlag = getEnv("EMAIL_SMTP_SECURE");
  const secure = secureFlag === undefined ? port === 465 : !/^(false|0|no|starttls)$/i.test(secureFlag);
  const replyTo = getEnv("EMAIL_REPLY_TO");

  return { host, port, secure, user, password, from, replyTo };
}

/** A protocol-level failure, in words the desk can show a person. */
export class SmtpError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "SmtpError";
    this.code = code;
  }
}

export interface SmtpReply {
  code: number;
  /** The full reply, including any multiline continuation lines. */
  text: string;
}

/* ------------------------------------------------------------ message building */

export interface OutgoingMail {
  /** From header — `Name <addr>` or a bare address. */
  from: string;
  /** The one recipient this message is addressed to. */
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EncodeOptions {
  date?: Date;
  messageId?: string;
}

/** CRLF everywhere: SMTP is a CRLF protocol, and a lone LF is a broken header to some servers. */
function crlf(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

/** Strips CR/LF so a value can never inject a header of its own. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Encodes a header as RFC 2047 when it carries anything outside printable ASCII. */
function headerText(value: string): string {
  const safe = headerValue(value);
  return /^[\x20-\x7e]*$/.test(safe) ? safe : `=?UTF-8?B?${base64Of(safe)}?=`;
}

/** The bare address out of `Name <addr>` (or the value itself, when there are no angle brackets). */
export function addressOf(value: string): string {
  const angle = /<([^>]+)>/.exec(value);
  if (angle) return angle[1].trim();
  return value.trim();
}

function base64Of(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Base64 is read in fixed-width lines, so long bodies wrap the way MIME asks. */
function wrapBase64(value: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += width) lines.push(value.slice(i, i + width));
  return lines.join("\r\n");
}

function dateHeader(date: Date): string {
  // toUTCString ends in "GMT"; RFC 5322 wants a numeric zone.
  return date.toUTCString().replace(/GMT$/, "+0000");
}

/**
 * The finished RFC 5322 message: headers, then a base64 body (optionally as
 * multipart/alternative when both a text and an HTML part exist).
 *
 * Returned *without* dot-stuffing — that belongs to the DATA step, because it
 * depends on how the payload is framed rather than on what it says.
 */
export function encodeMessage(mail: OutgoingMail, options: EncodeOptions = {}): string {
  const date = options.date ?? new Date();
  const from = headerValue(mail.from);
  const to = headerValue(mail.to);
  const domain = addressOf(from).split("@")[1] || "localhost";
  const messageId = options.messageId ?? `${crypto.randomUUID()}@${domain}`;

  const headers = [
    `Date: ${dateHeader(date)}`,
    `Message-ID: <${messageId}>`,
    `From: ${from}`,
    `To: ${to}`,
    ...(mail.replyTo ? [`Reply-To: ${headerValue(mail.replyTo)}`] : []),
    `Subject: ${headerText(mail.subject)}`,
    "MIME-Version: 1.0",
  ];

  let body: string;
  if (mail.html) {
    const boundary = `----bizlit-${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(base64Of(mail.text)),
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(base64Of(mail.html)),
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headers.push('Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64");
    body = `${wrapBase64(base64Of(mail.text))}\r\n`;
  }

  return `${crlf(headers.join("\r\n"))}\r\n\r\n${body}`;
}

/**
 * Dot-stuffs the DATA payload: a line beginning with "." would otherwise be
 * read as the end of the message. The payload's line endings are normalised to
 * CRLF here as well, so a body written with plain \n still travels correctly.
 */
export function dotStuff(payload: string): string {
  const lines = crlf(payload).split("\r\n");
  return lines.map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}

/* -------------------------------------------------------------------- session */

/**
 * The bytes on the wire, as the session driver sees them. Splitting here is
 * what lets the protocol be tested without a socket.
 */
export interface SmtpTransport {
  /** Reads one complete (possibly multiline) reply. */
  read(): Promise<SmtpReply>;
  /** Writes raw bytes — framing is the caller's job. */
  write(chunk: string): Promise<void>;
  close(): Promise<void>;
}

export interface SmtpSessionOptions {
  /** EHLO argument: the sending host as the server knows it. */
  hostname: string;
  user?: string;
  password?: string;
  /** Envelope sender — a bare address, already out of its `Name <>` wrapper. */
  mailFrom: string;
  rcptTo: string[];
  /** The message payload: CRLF line endings, not yet dot-stuffed, without the terminating dot. */
  data: string;
  /**
   * Upgrades the connection after STARTTLS and returns the transport to keep
   * using. Present only when the connection started in plaintext; the upgraded
   * transport takes ownership of the socket.
   */
  starttls?: () => Promise<SmtpTransport>;
}

/** Turns the server's refusal into a message about the step that caused it. */
function refusal(step: string, reply: SmtpReply): SmtpError {
  const first = reply.text.split("\n")[0];
  if (reply.code === 535 || /auth|login|password/i.test(first)) {
    return new SmtpError("The mail server rejected the SMTP username or password.", reply.code);
  }
  if (reply.code === 550 || reply.code === 551 || reply.code === 553) {
    return new SmtpError(`The mail server refused an address: ${first}`, reply.code);
  }
  return new SmtpError(`The mail server refused ${step}: ${first}`, reply.code);
}

/**
 * Drives one SMTP conversation: greet, EHLO, upgrade, authenticate, envelope,
 * DATA, quit. Every non-expected reply becomes an SmtpError naming the step —
 * which is what the desk shows the workspace when a send fails.
 */
export async function smtpSession(
  initial: SmtpTransport,
  options: SmtpSessionOptions,
): Promise<void> {
  let io = initial;

  const send = async (line: string): Promise<SmtpReply> => {
    await io.write(`${line}\r\n`);
    return io.read();
  };
  const expect = async (line: string, codes: number[], step: string): Promise<SmtpReply> => {
    const reply = await send(line);
    if (!codes.includes(reply.code)) throw refusal(step, reply);
    return reply;
  };

  const greeting = await io.read();
  if (greeting.code !== 220) throw refusal("the connection", greeting);

  let capabilities = await expect(`EHLO ${options.hostname}`, [250], "EHLO");

  if (options.starttls) {
    if (!/STARTTLS/i.test(capabilities.text)) {
      throw new SmtpError(
        `The mail server at ${options.hostname} does not offer STARTTLS. ` +
          "For implicit TLS set EMAIL_SMTP_SECURE=true with EMAIL_SMTP_PORT=465.",
      );
    }
    await expect("STARTTLS", [220], "STARTTLS");
    io = await options.starttls();
    capabilities =    await expect(`EHLO ${options.hostname}`, [250], "EHLO after STARTTLS");
  }


  if (options.user) {
    if (!options.password) throw new SmtpError("EMAIL_SMTP_PASS is not set on the server.");
    await expect("AUTH LOGIN", [334], "AUTH LOGIN");
    await expect(base64Of(options.user), [334], "the SMTP username");
    await expect(base64Of(options.password), [235], "the SMTP password");
  }

  await expect(`MAIL FROM:<${options.mailFrom}>`, [250], "the sender address");
  for (const recipient of options.rcptTo) {
    await expect(`RCPT TO:<${recipient}>`, [250, 251], "a recipient address");
  }
  await expect("DATA", [354], "DATA");

  // The payload already ends in CRLF; frame it as `…CRLF.CRLF` so the final
  // line is the message's last rather than an empty one.
  const framed = dotStuff(options.data).replace(/\r\n+$/, "");
  await io.write(`${framed}\r\n.\r\n`);
  const accepted = await io.read();
  if (accepted.code !== 250) throw refusal("the message", accepted);

  // QUIT is politeness, not protocol: a server that hangs up instead of
  // answering has already accepted the message, so neither step is an error.
  try {
    await io.write("QUIT\r\n");
    await io.read();
  } catch {
    /* the server closed first — the message is already in */
  }
}

/* ------------------------------------------------------------------ transport */

/** Generous, because a stalled socket must not hold an Edge Function open. */
const IO_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;

async function withTimeout<T>(work: Promise<T>, message: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => reject(new SmtpError(message)), ms);
      work.then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function indexOfCrlf(buffer: Uint8Array): number {
  for (let i = 0; i + 1 < buffer.length; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10) return i;
  }
  return -1;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A Deno socket, framed into SMTP lines and replies. */
class DenoTransport implements SmtpTransport {
  private buffer: Uint8Array;

  constructor(private conn: Deno.Conn, carried?: Uint8Array) {
    this.buffer = carried && carried.length ? carried : new Uint8Array(0);
  }

  private async line(): Promise<string> {
    for (;;) {
      const end = indexOfCrlf(this.buffer);
      if (end >= 0) {
        const text = decoder.decode(this.buffer.subarray(0, end));
        this.buffer = this.buffer.subarray(end + 2);
        return text;
      }
      const chunk = new Uint8Array(8_192);
      const read = await withTimeout(
        this.conn.read(chunk),
        "Timed out waiting for the mail server.",
        IO_TIMEOUT_MS,
      );
      if (read === null) throw new SmtpError("The mail server closed the connection.");
      const merged = new Uint8Array(this.buffer.length + read);
      merged.set(this.buffer);
      merged.set(chunk.subarray(0, read), this.buffer.length);
      this.buffer = merged;
    }
  }

  async read(): Promise<SmtpReply> {
    const first = await this.line();
    const code = Number.parseInt(first.slice(0, 3), 10);
    if (!Number.isInteger(code) || first.slice(0, 3).length < 3) {
      throw new SmtpError(`The mail server sent an unexpected reply: ${first.slice(0, 80)}`);
    }

    let text = first;
    if (first.charAt(3) === "-") {
      // Multiline reply: same code, "-" until the last line, which ends in " ".
      for (;;) {
        const next = await this.line();
        text += `\n${next}`;
        if (next.slice(0, 3) === String(code) && next.charAt(3) === " ") break;
        if (!/^\d{3}[ -]/.test(next)) {
          throw new SmtpError(`The mail server sent an unexpected reply: ${next.slice(0, 80)}`);
        }
      }
    }
    return { code, text };
  }

  async write(chunk: string): Promise<void> {
    const bytes = encoder.encode(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await withTimeout(
        this.conn.write(bytes.subarray(offset)),
        "Timed out writing to the mail server.",
        IO_TIMEOUT_MS,
      );
      if (written === 0) throw new SmtpError("The mail server stopped accepting data.");
      offset += written;
    }
  }

  async close(): Promise<void> {
    try {
      this.conn.close();
    } catch {
      /* already closed */
    }
  }

  /** Bytes read past the last complete line — handed over when STARTTLS upgrades the socket. */
  takeBuffered(): Uint8Array {
    const rest = this.buffer;
    this.buffer = new Uint8Array(0);
    return rest;
  }
}

/** Opens the connection the settings ask for, plus the upgrade when it starts in plaintext. */
export async function connectSmtp(settings: SmtpSettings): Promise<{
  transport: SmtpTransport;
  starttls?: () => Promise<SmtpTransport>;
}> {
  if (settings.secure) {
    const conn = await withTimeout(
      Deno.connectTls({ hostname: settings.host, port: settings.port }),
      `Timed out connecting to ${settings.host}.`,
      CONNECT_TIMEOUT_MS,
    );
    return { transport: new DenoTransport(conn) };
  }

  const conn = await withTimeout(
    Deno.connect({ hostname: settings.host, port: settings.port }),
    `Timed out connecting to ${settings.host}.`,
    CONNECT_TIMEOUT_MS,
  );
  const plain = new DenoTransport(conn);
  return {
    transport: plain,
    starttls: async () => {
      const tls = await withTimeout(
        Deno.startTls(conn, { hostname: settings.host }),
        `Timed out securing the connection to ${settings.host}.`,
        CONNECT_TIMEOUT_MS,
      );
      return new DenoTransport(tls, plain.takeBuffered());
    },
  };
}

/** One message, one connection: isolation between sends is worth more than a pooled socket here. */
export async function sendSmtpMail(settings: SmtpSettings, mail: OutgoingMail): Promise<void> {
  const recipient = addressOf(mail.to);
  if (!recipient) throw new SmtpError("This customer has no email address.");

  const from = mail.from || settings.from;
  const payload = encodeMessage({ ...mail, from, replyTo: mail.replyTo ?? settings.replyTo });

  const connection = await connectSmtp(settings);
  let io = connection.transport;
  const upgrade = connection.starttls;
  try {
    await smtpSession(io, {
      hostname: settings.host,
      user: settings.user,
      password: settings.password,
      mailFrom: addressOf(from),
      rcptTo: [recipient],
      data: payload,
      starttls: upgrade
        ? async () => {
            io = await upgrade();
            return io;
          }
        : undefined,
    });
  } finally {
    await io.close();
  }
}

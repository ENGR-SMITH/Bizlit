import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyDb,
  seedBusiness,
  seedClient,
  seedMailAccount,
  state,
} from "./helpers/mailGateway";

/**
 * The real `client-mail` handler, driven end to end with the three boundaries
 * it cannot run without faked: Clerk's identity check, Postgres and the SMTP
 * socket. Everything between them is shipped code — the handler, the settings
 * reader, the composition and subjects in `_shared/mail.ts`, the schedule
 * mirror and the writing of each outcome to `sent_messages`.
 *
 * That is what makes the delivery guarantees checkable without a session, a
 * tenant or a mail server: a refused recipient is recorded as failed and stays
 * due, only accepted sends reschedule, and the scheduled run mails exactly who
 * has passed their `next_send_at`.
 */

const denoEnv = new Map<string, string>();
let handler: ((req: Request) => Promise<Response>) | null = null;

// Stubbed before the function is imported: `Deno.serve` runs at module load.
vi.stubGlobal("Deno", {
  env: { get: (name: string) => denoEnv.get(name) },
  serve: (fn: (req: Request) => Promise<Response>) => {
    handler = fn;
  },
});

vi.mock("../supabase/functions/_shared/supabaseAdmin.ts", async () => {
  const helper = await import("./helpers/mailGateway");
  return { adminClient: helper.adminClient };
});

vi.mock("../supabase/functions/_shared/auth.ts", async () => {
  const helper = await import("./helpers/mailGateway");
  return { requireCaller: helper.requireCaller, assertBusinessOwned: helper.assertBusinessOwned };
});

/** The socket is the third boundary: a test run must not dial a mail server. */
const mailState: {
  sent: { to: string; subject: string; html: string }[];
  failFor: Set<string>;
} = { sent: [], failFor: new Set() };

vi.mock("../supabase/functions/_shared/smtp.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../supabase/functions/_shared/smtp")>();
  return {
    ...actual,
    sendSmtpMail: async (_settings: unknown, mail: { to: string; subject: string; html?: string }) => {
      if (mailState.failFor.has(mail.to)) {
        throw new actual.SmtpError("The mail server refused the message.", 550);
      }
      mailState.sent.push({ to: mail.to, subject: mail.subject, html: mail.html ?? "" });
    },
  };
});

await import("../supabase/functions/client-mail/index.ts");

async function call(
  payload: Record<string, unknown>,
  options: { userId?: string | null; token?: string; jobSecret?: string } = {},
) {
  if (!handler) throw new Error("the handler was never captured");
  state.userId = options.userId === undefined ? "user-a" : options.userId;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.jobSecret) headers["x-mail-job-secret"] = options.jobSecret;

  const response = await handler(
    new Request("http://localhost/functions/v1/client-mail", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const configured = () => {
  denoEnv.set("EMAIL_SMTP_HOST", "mail.spacemail.com");
  denoEnv.set("EMAIL_SMTP_PORT", "465");
  denoEnv.set("EMAIL_SMTP_USER", "no-reply@example.com");
  denoEnv.set("EMAIL_SMTP_PASS", "mailbox-password");
  denoEnv.set("EMAIL_FROM", "BIZLIT <no-reply@example.com>");
};

beforeEach(() => {
  denoEnv.clear();
  configured();
  state.db = emptyDb();
  state.userId = "user-a";
  mailState.sent.length = 0;
  mailState.failFor.clear();
});

afterEach(() => {
  // The `Deno` double stays: the module under test reads it on every call.
  vi.unstubAllGlobals();
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => denoEnv.get(name) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn;
    },
  });
});

describe("configuration", () => {
  it("refuses with the variables to set when SMTP is not configured", async () => {
    denoEnv.clear();
    seedBusiness();
    const client = seedClient();

    const res = await call(
      { businessId: "biz-1", clientIds: [client.id] },
      { token: "session-token" },
    );

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("EMAIL_SMTP_HOST");
    expect(res.body.error).toContain("EMAIL_SMTP_PASS");
    expect(mailState.sent).toHaveLength(0);
  });
});

describe("manual sends", () => {
  it("mails the named customers and records each as delivered", async () => {
    seedBusiness();
    seedMailAccount();
    const first = seedClient({ email: "ada@example.com", company: "GlowMart Beauty" });
    const second = seedClient({ email: "sam@example.com", company: "GlowMart Beauty" });

    const res = await call(
      { businessId: "biz-1", clientIds: [first.id, second.id] },
      { token: "session-token" },
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 2, failed: 0 });

    // What left the desk is what the schedule tab previewed, addressed to the
    // customer's own email.
    expect(mailState.sent.map((m) => m.to).sort()).toEqual(["ada@example.com", "sam@example.com"]);
    expect(mailState.sent[0].subject).toBe("Live deals you can promote today");
    expect(mailState.sent[0].html).toContain("GlowMart Beauty");

    const logged = state.db.sent_messages;
    expect(logged).toHaveLength(2);
    expect(logged.every((row) => row.status === "delivered")).toBe(true);
    expect(logged[0].business_id).toBe("biz-1");

    // Both customers are rescheduled, and now have been contacted.
    for (const client of [first, second]) {
      expect(client.last_contacted_at).not.toBeNull();
      expect(String(client.next_send_at)).not.toBe("2026-09-01T08:00:00.000Z");
    }
  });

  it("records a refusal as a failure and leaves that customer due", async () => {
    seedBusiness();
    seedMailAccount();
    const good = seedClient({ email: "ada@example.com" });
    const refused = seedClient({ email: "bounce@example.com" });
    mailState.failFor.add("bounce@example.com");

    const res = await call(
      { businessId: "biz-1", clientIds: [good.id, refused.id] },
      { token: "session-token" },
    );

    expect(res.body).toMatchObject({ sent: 1, failed: 1 });
    const failure = res.body.results.find((r: any) => r.status === "failed");
    expect(failure.clientId).toBe(refused.id);
    expect(failure.error).toContain("refused");

    const logged = state.db.sent_messages;
    expect(logged.find((row) => row.client_id === refused.id)?.status).toBe("failed");
    expect(logged.find((row) => row.client_id === good.id)?.status).toBe("delivered");

    // Only the accepted send moves on; the refused one stays due for a retry.
    expect(refused.next_send_at).toBe("2026-09-01T08:00:00.000Z");
    expect(String(good.next_send_at)).not.toBe("2026-09-01T08:00:00.000Z");
  });

  it("reports an error rather than a success when nothing was accepted", async () => {
    seedBusiness();
    seedMailAccount();
    const client = seedClient({ email: "bounce@example.com" });
    mailState.failFor.add("bounce@example.com");

    const res = await call({ businessId: "biz-1", clientIds: [client.id] }, { token: "session-token" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, failed: 1 });
    expect(res.body.results[0].error).toBeTruthy();
  });

  it("will not mail another workspace's customers", async () => {
    seedBusiness("biz-1", "user-a");
    seedBusiness("biz-2", "user-b");
    const foreign = seedClient({ business_id: "biz-2" });

    // Naming someone else's workspace is refused outright —
    const wrongTenant = await call(
      { businessId: "biz-2", clientIds: [foreign.id] },
      { token: "session-token" },
    );
    expect(wrongTenant.status).toBe(403);

    // — and an id from outside one's own workspace is simply not on the list.
    const wrongId = await call(
      { businessId: "biz-1", clientIds: [foreign.id] },
      { token: "session-token" },
    );
    expect(wrongId.status).toBe(404);

    expect(mailState.sent).toHaveLength(0);
    expect(state.db.sent_messages).toHaveLength(0);
  });

  it("asks for a session before it asks for anything else", async () => {
    seedBusiness();

    const res = await call({ businessId: "biz-1", clientIds: ["client-1"] });

    expect(res.status).toBe(401);
  });

  it("refuses an empty selection", async () => {
    seedBusiness();

    const res = await call({ businessId: "biz-1", clientIds: [] }, { token: "session-token" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one customer/i);
  });
});

describe("the scheduled run", () => {
  beforeEach(() => {
    denoEnv.set("MAIL_JOB_SECRET", "cron-shared-secret");
  });

  it("mails only the active customers whose next send has arrived", async () => {
    seedBusiness();
    seedMailAccount();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const due = seedClient({ email: "due@example.com", next_send_at: past });
    seedClient({ email: "later@example.com", next_send_at: future });
    seedClient({ email: "paused@example.com", status: "paused", next_send_at: past });

    const res = await call({}, { jobSecret: "cron-shared-secret" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, failed: 0, due: 1, businesses: 1 });
    expect(mailState.sent.map((m) => m.to)).toEqual(["due@example.com"]);
    expect(state.db.sent_messages).toHaveLength(1);
    expect(String(due.next_send_at)).not.toBe(past);
  });

  it("says so plainly when nobody is due", async () => {
    seedBusiness();
    seedClient({ next_send_at: new Date(Date.now() + 86_400_000).toISOString() });

    const res = await call({}, { jobSecret: "cron-shared-secret" });

    expect(res.body).toMatchObject({ sent: 0, failed: 0, due: 0, businesses: 0 });
    expect(mailState.sent).toHaveLength(0);
    expect(state.db.sent_messages).toHaveLength(0);
  });

  it("does not accept a guessed secret as a scheduled run", async () => {
    seedBusiness();
    seedClient({ next_send_at: new Date(Date.now() - 86_400_000).toISOString() });

    const res = await call({}, { jobSecret: "not-the-secret" });

    // Falls through to the session check, which a cron job cannot pass.
    expect(res.status).toBe(401);
    expect(mailState.sent).toHaveLength(0);
  });
});

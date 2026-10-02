import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { nextSendAt, sendClientUpdate, subjectFor, type UpdateRecipient } from "../_shared/mail.ts";
import { smtpSettings, type SmtpSettings } from "../_shared/smtp.ts";

/**
 * Client mail delivery.
 *
 * Two ways in, one delivery path:
 *
 *   - **Manual** — the desk's Send buttons. A signed-in caller proves the
 *     workspace is theirs (`requireCaller` + `assertBusinessOwned`) and names
 *     the customers to mail.
 *   - **Scheduled** — whoever is due. A cron job presents `MAIL_JOB_SECRET` in
 *     the `x-mail-job-secret` header, and the run mails every active customer
 *     whose `next_send_at` has passed, then reschedules each one. There is no
 *     session to verify in that path, which is exactly why it needs its own
 *     secret rather than being left open.
 *
 * Either way the outcome is a fact, not a hope: each send is attempted on its
 * own, every attempt is written to `sent_messages` with its real status
 * (`delivered` or `failed`), and only delivered customers are rescheduled — a
 * failure stays due so the next run retries it instead of skipping a cadence.
 *
 * Deploy with `--no-verify-jwt`: the bearer token here is a Clerk token,
 * verified by `requireCaller`, not a Supabase one.
 */
interface Body {
  businessId?: string;
  clientIds?: string[];
}

/** One customer, as far as this function needs them. */
interface ClientRow {
  id: string;
  business_id?: string | null;
  name: string;
  company: string | null;
  email: string | null;
  message_types: string[] | null;
  frequency: string | null;
}

export interface SendOutcome {
  clientId: string;
  status: "delivered" | "failed";
  subject: string;
  error?: string;
}

export interface BatchResult {
  sent: number;
  failed: number;
  results: SendOutcome[];
}

interface SenderContext {
  senderName?: string;
  brandName?: string;
  signature?: string;
  replyTo?: string;
}

/** One press of Send cannot mail the whole list; a scheduled run is bounded too. */
const MAX_MANUAL_BATCH = 100;
const MAX_SCHEDULED_BATCH = 200;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const settings = smtpSettings();
    if (!settings) {
      throw new HttpError(
        409,
        "Email sending is not configured on this deployment yet — set EMAIL_SMTP_HOST, " +
          "EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS and EMAIL_FROM (Spacemail SMTP) " +
          "as Edge Function secrets, then deploy this function again.",
      );
    }

    const jobSecret = getEnv("MAIL_JOB_SECRET");
    const presented = req.headers.get("x-mail-job-secret") ?? "";
    if (jobSecret && presented && constantTimeEqual(presented, jobSecret)) {
      return json(await runDue(settings));
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const clientIds = Array.isArray(body.clientIds)
      ? body.clientIds.map(String).filter(Boolean)
      : [];
    if (!clientIds.length) throw new HttpError(400, "Pick at least one customer to mail.");
    if (clientIds.length > MAX_MANUAL_BATCH) {
      throw new HttpError(400, `At most ${MAX_MANUAL_BATCH} customers can be mailed in one go.`);
    }

    return json(await runBatch(settings, businessId, clientIds));
  } catch (cause) {
    return failure(cause);
  }
});

/** Compares two secrets without leaking how close a guess was through timing. */
function constantTimeEqual(presented: string, expected: string): boolean {
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The sending identity: the workspace's own sender, brand and signature. */
async function senderFor(
  businessId: string,
): Promise<SenderContext> {
  const db = adminClient();
  const [account, business] = await Promise.all([
    db.from("mail_accounts").select("sender_name, reply_to, signature").eq("business_id", businessId).maybeSingle(),
    db.from("businesses").select("brand_name").eq("id", businessId).maybeSingle(),
  ]);
  if (account.error) throw new HttpError(500, account.error.message);
  if (business.error) throw new HttpError(500, business.error.message);

  const row = account.data as { sender_name?: string | null; reply_to?: string | null; signature?: string | null } | null;
  const firm = business.data as { brand_name?: string | null } | null;

  return {
    senderName: row?.sender_name || firm?.brand_name || undefined,
    brandName: firm?.brand_name || undefined,
    signature: row?.signature || undefined,
    replyTo: row?.reply_to || undefined,
  };
}

/** Sends to each customer in turn, collecting what each attempt actually did. */
async function deliverAll(
  settings: SmtpSettings,
  sender: SenderContext,
  clients: ClientRow[],
): Promise<BatchResult> {
  const results: SendOutcome[] = [];

  for (const client of clients) {
    const company = client.company || client.name;
    const params: UpdateRecipient = {
      from: settings.from,
      replyTo: settings.replyTo ?? sender.replyTo,
      to: client.email ?? "",
      clientName: client.name,
      company,
      types: client.message_types ?? [],
      senderName: sender.senderName,
      brandName: sender.brandName,
      signature: sender.signature,
    };
    const subject = subjectFor(company, params.types);

    try {
      const sent = await sendClientUpdate(settings, params);
      results.push({ clientId: client.id, status: "delivered", subject: sent.subject });
    } catch (cause) {
      results.push({
        clientId: client.id,
        status: "failed",
        subject,
        error: cause instanceof Error ? cause.message : "The mail server refused the message.",
      });
    }
  }

  return {
    sent: results.filter((r) => r.status === "delivered").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}

/**
 * Writes the outcome where the desk reads it, and advances the schedule for the
 * customers the server actually accepted. A failed send keeps its old
 * `next_send_at`, so it remains due rather than quietly losing a cadence.
 */
async function record(
  businessId: string,
  clients: ClientRow[],
  result: BatchResult,
): Promise<void> {
  const db = adminClient();
  const now = new Date().toISOString();
  const byId = new Map(result.results.map((outcome) => [outcome.clientId, outcome]));

  const rows = clients.map((client) => {
    const outcome = byId.get(client.id);
    return {
      business_id: businessId,
      client_id: client.id,
      client_name: client.name,
      subject: outcome?.subject ?? subjectFor(client.company || client.name, client.message_types ?? []),
      types: client.message_types ?? [],
      status: outcome?.status ?? "failed",
      sent_at: now,
    };
  });
  const { error } = await db.from("sent_messages").insert(rows);
  if (error) throw new HttpError(500, error.message);

  for (const client of clients) {
    if (byId.get(client.id)?.status !== "delivered") continue;
    const { error: updateError } = await db
      .from("clients")
      .update({
        last_contacted_at: now,
        next_send_at: nextSendAt(client.frequency ?? "weekly", client.message_types ?? []),
      })
      .eq("id", client.id);
    if (updateError) throw new HttpError(500, updateError.message);
  }
}

/** The manual path: the customers this workspace named, scoped to that workspace. */
async function runBatch(
  settings: SmtpSettings,
  businessId: string,
  clientIds: string[],
): Promise<BatchResult> {
  const db = adminClient();
  const { data, error } = await db
    .from("clients")
    .select("id, business_id, name, company, email, message_types, frequency")
    .eq("business_id", businessId)
    .in("id", clientIds);
  if (error) throw new HttpError(500, error.message);

  const clients = (data ?? []) as unknown as ClientRow[];
  if (!clients.length) throw new HttpError(404, "Those customers are not on your list.");

  const sender = await senderFor(businessId);
  const result = await deliverAll(settings, sender, clients);
  await record(businessId, clients, result);
  return result;
}

interface DueResult extends BatchResult {
  /** How many customers were due, which can exceed `sent + failed` only in a capped run. */
  due: number;
  businesses: number;
}

/** The scheduled path: everyone whose next send has arrived, workspace by workspace. */
async function runDue(settings: SmtpSettings): Promise<DueResult> {
  const db = adminClient();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("clients")
    .select("id, business_id, name, company, email, message_types, frequency")
    .eq("status", "active")
    .lte("next_send_at", now)
    .order("next_send_at", { ascending: true })
    .limit(MAX_SCHEDULED_BATCH);
  if (error) throw new HttpError(500, error.message);

  const due = (data ?? []) as unknown as ClientRow[];
  if (!due.length) return { sent: 0, failed: 0, results: [], due: 0, businesses: 0 };

  const byBusiness = new Map<string, ClientRow[]>();
  for (const client of due) {
    const key = String(client.business_id ?? "");
    if (!key) continue;
    const group = byBusiness.get(key);
    if (group) group.push(client);
    else byBusiness.set(key, [client]);
  }

  const results: SendOutcome[] = [];
  let sent = 0;
  let failed = 0;
  let businesses = 0;

  for (const [businessId, clients] of byBusiness) {
    businesses += 1;
    const sender = await senderFor(businessId);
    const batch = await deliverAll(settings, sender, clients);
    results.push(...batch.results);
    sent += batch.sent;
    failed += batch.failed;
    // One workspace's failure must not stop the rest of the run: each group
    // records what it managed, and a group that cannot be recorded at all is
    // reported through the thrown error of the whole call.
    await record(businessId, clients, batch);
  }

  return { sent, failed, results, due: due.length, businesses };
}

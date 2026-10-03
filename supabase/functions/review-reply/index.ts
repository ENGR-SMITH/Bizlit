import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { withIdempotency } from "../_shared/idempotency.ts";
import { platformLabelOf, repliesConfigured, sendReply } from "../_shared/reviews.ts";

/**
 * Review reply.
 *
 * Sends one reply to one review and records it against the review plus the reply
 * history. A reply only ever goes out because the user pressed send — nothing
 * here auto-replies, which is the guardrail from the blueprint (no unreviewed
 * AI text reaching the public).
 *
 * Replying needs a platform business API, and for Google that is the workspace's
 * own Business Profile connected through OAuth: Google only honours a review id
 * it issued itself, so a scraped id cannot be replied to. `_shared/reviews.ts`
 * resolves the stored row against Google's own list and posts against that, and
 * refuses with the reason (not connected, needs reconnecting, API access not
 * granted, review not ours) when it cannot. The composer keeps working either
 * way — copy-and-paste and "I posted it myself" are the fallback paths.
 *
 * The idempotency key is derived from the review, so a retried submit returns the
 * first result instead of posting a second reply.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  reviewId?: string;
  /** The reply text the user wrote (or accepted from the suggestion). */
  reply?: string;
  idempotencyKey?: string;
}

/** Platforms have their own limits; a generous shared ceiling keeps us inside them. */
const MAX_REPLY_LENGTH = 4_000;

interface ReviewRow {
  id: string;
  external_id: string | null;
  platform: string | null;
  source: string | null;
  /** The stored review itself — what a match against Google's list is made on. */
  author: string | null;
  rating: number | null;
  body: string | null;
  /** Google's resource name once this row has been resolved, so a resend skips the search. */
  google_review_name: string | null;
  replied: boolean;
  reply_text: string | null;
  replied_at: string | null;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!repliesConfigured()) {
      throw new HttpError(
        409,
        "Sending replies is not available on this deployment yet — it needs your own Google Business Profile connected (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Copy the suggested reply across by hand for now.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const reviewId = String(body.reviewId ?? "");
    if (!reviewId) throw new HttpError(400, "A review id is required.");

    const reply = String(body.reply ?? "").trim();
    if (!reply) throw new HttpError(400, "Write a reply before sending it.");
    if (reply.length > MAX_REPLY_LENGTH) {
      throw new HttpError(400, `Replies are limited to ${MAX_REPLY_LENGTH} characters.`);
    }

    const db = adminClient();

    const result = await withIdempotency(
      db,
      businessId,
      "reviews",
      body.idempotencyKey || `reply:${reviewId}`,
      async () => {
        const { data: review, error } = await db
          .from("my_reviews")
          .select(
            "id, external_id, platform, source, author, rating, body, google_review_name, replied, reply_text, replied_at",
          )
          .eq("id", reviewId)
          .eq("business_id", businessId)
          .maybeSingle();
        if (error) throw new HttpError(500, error.message);
        if (!review) throw new HttpError(404, "That review is not in this workspace.");

        const row = review as ReviewRow;

        // Already replied (here or at the provider): report the existing reply
        // rather than posting a second one.
        if (row.replied) {
          return { replyText: row.reply_text ?? "", repliedAt: row.replied_at, alreadyReplied: true };
        }
        if (!row.external_id) {
          throw new HttpError(
            409,
            "This review has no provider id yet. Re-run the review sync, then reply.",
          );
        }

        const platform = String(row.platform || row.source || "");
        const handle = await handleForPlatform(db, businessId, row.platform ?? "");

        try {
          const sent = await sendReply(db, {
            businessId,
            platform,
            reviewExternalId: row.external_id,
            handle,
            body: reply,
            author: row.author ?? "",
            rating: row.rating ?? undefined,
            text: row.body ?? "",
            googleReviewName: row.google_review_name ?? "",
          });

          const { error: updateError } = await db
            .from("my_reviews")
            .update({
              replied: true,
              reply_text: reply,
              replied_at: sent.repliedAt,
              // Cached only once Google has accepted a reply against it: from
              // here on the row carries the id Google knows, not the scraped one.
              google_review_name: sent.reviewName ?? row.google_review_name ?? null,
            })
            .eq("id", row.id)
            .eq("business_id", businessId);
          if (updateError) throw new HttpError(500, updateError.message);

          await db.from("review_replies").insert({
            business_id: businessId,
            review_id: row.id,
            platform,
            body: reply,
            provider_reply_id: sent.replyId,
            status: "sent",
          });

          await recordUsage(db, {
            businessId,
            provider: "reviews",
            endpoint: "replies",
            units: 1,
            detail: `${platformLabelOf(platform)} review reply`,
          });

          return { replyText: reply, repliedAt: sent.repliedAt, alreadyReplied: false };
        } catch (cause) {
          // Keep the failed attempt in the history so the UI can explain it, but
          // leave `replied` false so the user can edit and try again.
          await db.from("review_replies").insert({
            business_id: businessId,
            review_id: row.id,
            platform,
            body: reply,
            status: "failed",
            error: (cause instanceof Error ? cause.message : "The reply was rejected.").slice(0, 300),
          });
          throw cause;
        }
      },
    );

    return json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
});

/** The public handle of the connection covering a platform, when we have one. */
async function handleForPlatform(
  db: ReturnType<typeof adminClient>,
  businessId: string,
  platform: string,
): Promise<string> {
  if (!platform) return "";
  const { data } = await db
    .from("review_connections")
    .select("handle")
    .eq("business_id", businessId)
    .eq("platform", platform)
    .limit(1);
  return String((data ?? [])[0]?.handle ?? "");
}

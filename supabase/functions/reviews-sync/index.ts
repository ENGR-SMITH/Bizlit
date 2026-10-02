import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { clampInt } from "../_shared/keywords.ts";
import { affordableCount, budgetMessage, readBudget, readSpend, spendMessage } from "../_shared/budget.ts";
import {
  DEFAULT_MAX_REVIEWS,
  collectReviewScrape,
  fetchReviews,
  googleReviewSearchCost,
  needsPlaceLookup,
  platformLabelOf,
  readReviewScrape,
  readerFor,
  reviewRunFinished,
  reviewTrendLabel,
  reviewsConfigured,
  REVIEW_TREND_WINDOW,
  sentimentForRating,
  startReviewScrape,
  suggestedAction,
  type ReviewRun,
  type SyncedReview,
} from "../_shared/reviews.ts";

/**
 * Review sync.
 *
 * For each review profile the workspace has connected, this pulls the profile's
 * recent reviews and upserts them into `my_reviews` keyed on the provider's
 * review id, so a re-run updates rows instead of duplicating them. It then
 * refreshes the per-source score rows the Social & reviews page trends on.
 *
 * Reviews come from what the workspace already pays for rather than a dedicated
 * review vendor: Google and TripAdvisor through SerpApi, the rest through an
 * Apify actor. Each read is therefore logged against **that** provider's
 * allowance, so the existing SerpApi unit cap and Apify dollar cap bound review
 * spend without a separate budget.
 *
 * Reviews are stored as data, never re-published. Replying is a separate,
 * currently-unavailable path (see `_shared/reviews.ts`).
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  /** Sync just one connected profile. */
  connectionId?: string;
  /** Reviews to keep per profile (both SerpApi engines cap a page at 20). */
  limit?: number;
}

interface ConnectionRow {
  id: string;
  platform: string;
  handle: string;
  label: string;
  /** An Apify run started for this profile that we have not collected yet. */
  last_run_id: string;
  last_run_status: string;
}

/** The admin client, passed to the helpers below. */
type Db = ReturnType<typeof adminClient>;

/** Hard caps, so one request cannot fan out without bound. */
const MAX_PROFILES = 10;
const DEFAULT_PROFILES = 5;
const MAX_REVIEWS_PER_CALL = 20;

/** How many rows a sync is willing to read back for de-duplication. */
const EXISTING_LIMIT = 500;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!reviewsConfigured()) {
      throw new HttpError(
        409,
        "Review monitoring is not configured on the server. Add SERPAPI_KEY (Google and TripAdvisor reviews) or APIFY_TOKEN (other platforms) to the function secrets.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const db = adminClient();
    const limit = clampInt(body.limit, 1, MAX_REVIEWS_PER_CALL, DEFAULT_MAX_REVIEWS);

    const { data: connectionRows, error: connectionError } = await db
      .from("review_connections")
      .select("id, platform, handle, label, last_run_id, last_run_status")
      .eq("business_id", businessId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (connectionError) throw new HttpError(500, connectionError.message);

    const connections = (connectionRows ?? []) as ConnectionRow[];
    if (!connections.length) {
      // Only `status = 'active'` rows reach a sync, so an empty list means either
      // nothing is connected or everything connected needs attention. Saying
      // "nothing is connected" in the second case sends the user to add a profile
      // they already have, so the two are told apart here.
      const { count } = await db
        .from("review_connections")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId);
      if (count) {
        throw new HttpError(
          409,
          `${count} review profile${count === 1 ? " needs" : "s need"} reconnecting before it can sync. Remove and re-add it on Social & reviews.`,
        );
      }
      throw new HttpError(
        409,
        "No review profiles connected yet. Add your Google, Trustpilot or Yelp page, then sync again.",
      );
    }

    const profileLimit = clampInt(undefined, 1, MAX_PROFILES, DEFAULT_PROFILES);
    const matching = connections.filter((c) => !body.connectionId || c.id === body.connectionId);
    const selected = matching.slice(0, profileLimit);
    /** True when the profile limit, not the connected list, cut the run short. */
    const capped = selected.length < matching.length;

    const startedAt = new Date().toISOString();
    const skipped: { profile: string; reason: string }[] = [];
    const errors: string[] = [];

    // Existing reply state, so a sync that runs before the provider reflects our
    // reply does not wipe it back to "not replied".
    const { data: existingRows } = await db
      .from("my_reviews")
      .select("external_id, replied, reply_text, replied_at")
      .eq("business_id", businessId)
      .not("external_id", "is", null)
      .limit(EXISTING_LIMIT);
    const existing = new Map<string, { replied: boolean; replyText: string; repliedAt: string | null }>();
    for (const row of existingRows ?? []) {
      existing.set(String(row.external_id), {
        replied: Boolean(row.replied),
        replyText: String(row.reply_text ?? ""),
        repliedAt: row.replied_at ? String(row.replied_at) : null,
      });
    }

    let synced = 0;
    let flagged = 0;
    /** Profiles whose scrape is still working; their run is collected next sync. */
    let running = 0;
    const byId = new Map<string, SyncedReview>();

    for (const connection of selected) {
      const label = connection.label || platformLabelOf(connection.platform);
      const reader = readerFor(connection.platform);
      // A name or URL costs one extra search to resolve into the id the reader
      // wants, and a Google read walks up to three pages of 8. Budgeted with the
      // worst case before the call rather than discovered after it.
      const searches =
        reader === "serpapi" && connection.platform.trim().toLowerCase() === "google"
          ? googleReviewSearchCost(connection.handle, limit)
          : 1 + (reader === "serpapi" && needsPlaceLookup(connection.platform, connection.handle) ? 1 : 0);

      try {
        let reviews: SyncedReview[];
        // Billed units and dollars, recorded against whoever actually paid.
        let units: number;
        let costUsd: number;
        let endpoint: string;

        if (reader === "apify") {
          const outcome = await apifyProfileReviews(db, businessId, connection, limit);
          if (outcome.running) {
            // The run is kept, not discarded: its id is on the connection, so the
            // next sync finishes the job and records its cost then. Nothing is
            // logged now — the charge has not been collected yet.
            running += 1;
            await db
              .from("review_connections")
              .update({ last_error: "" })
              .eq("id", connection.id);
            continue;
          }
          reviews = outcome.reviews;
          units = reviews.length;
          // The run's own figure when Apify reported one, so the usage panel
          // shows what was actually charged rather than the ceiling we allowed.
          costUsd = outcome.run?.usageTotalUsd || reviewScrapeCostUsd();
          endpoint = "actor-runs";
        } else {
          await assertReaderBudget(db, businessId, reader, searches);
          const outcome = await fetchReviews(connection.platform, connection.handle, limit);
          reviews = outcome.reviews;
          // What the read actually cost, not the ceiling it was budgeted against.
          units = outcome.searches;
          costUsd = 0;
          endpoint = `reviews:${connection.platform}`;
        }

        if (!reviews.length) {
          skipped.push({ profile: label, reason: "no reviews returned for this profile" });
        }
        for (const review of reviews) byId.set(review.externalId, review);
        synced += 1;

        await recordUsage(db, {
          businessId,
          provider: reader,
          endpoint,
          units,
          costUsd,
          detail: `${connection.platform} ${connection.handle}: ${reviews.length} reviews`,
        });

        await db
          .from("review_connections")
          .update({ last_synced_at: new Date().toISOString(), last_error: "" })
          .eq("id", connection.id);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The review sync failed.";
        errors.push(`${label}: ${message}`);
        // Only a *credential* refusal means the profile has to be reconnected by
        // hand. Everything else — a rate limit, a provider outage, or a request the
        // provider rejected (a 400 from a parameter rule, say) — is transient or
        // fixable in code. Marking those `needs_reauth` would drop the profile out
        // of every later sync, which only reads `status = 'active'`, and tell the
        // user to reconnect a healthy row. Keeping it active retries next sync, and
        // the error stays on the row for the UI to show.
        const providerStatus =
          cause instanceof HttpError ? (cause.providerStatus ?? cause.status) : 0;
        const needsReconnect = providerStatus === 401 || providerStatus === 403;
        await db
          .from("review_connections")
          .update(
            needsReconnect
              ? { last_error: message.slice(0, 300), status: "needs_reauth" }
              : { last_error: message.slice(0, 300) },
          )
          .eq("id", connection.id);
      }
    }

    /* ------------------------------------------------------------- persist */

    const payload = [...byId.values()].map((review) => {
      const sentiment = sentimentForRating(review.rating);
      if (sentiment === "negative") flagged += 1;
      const prior = existing.get(review.externalId);
      const row: Record<string, unknown> = {
        business_id: businessId,
        external_id: review.externalId,
        platform: review.platform,
        source: platformLabelOf(review.platform),
        author: review.author,
        rating: review.rating,
        language: review.language,
        body: review.text,
        sentiment,
        action: suggestedAction(review.rating, sentiment),
        is_flagged: sentiment === "negative",
        posted_at: review.postedAt ?? new Date().toISOString(),
      };
      // Only ever upgrade reply state here: the provider is the source of truth
      // for its own replies, but our own sent reply must survive until it catches up.
      //
      // Written unconditionally, never as an `if` that adds the keys to some rows
      // only. A bulk upsert pads every key a row omits with NULL, and `replied`
      // and `reply_text` are NOT NULL — so one replied review in the batch would
      // fail the insert for all the others.
      const hasReply = review.replied || prior?.replied === true;
      row.replied = hasReply;
      row.reply_text = hasReply ? review.replyText || prior?.replyText || "" : "";
      row.replied_at = hasReply ? (prior?.repliedAt ?? review.postedAt ?? null) : null;
      return row;
    });

    if (payload.length) {
      const { error } = await db
        .from("my_reviews")
        .upsert(payload, { onConflict: "business_id,external_id" });
      if (error) throw new HttpError(500, error.message);
    }

    const summary = await refreshSources(db, businessId);

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "reviews",
      source_name: "Review sync",
      status: errors.length && !synced ? "failed" : "succeeded",
      changes_found: payload.length,
      // The reason, not just the fact: the health panel shows this text, and a
      // null error leaves it guessing ("the provider did not return a result").
      error: errors.length ? errors.slice(0, 3).join(" · ").slice(0, 500) : null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    if (!synced && errors.length) throw new HttpError(502, errors[0]);

    return json({
      profiles: synced,
      reviews: payload.length,
      flagged,
      running,
      ...summary,
      capped,
      skipped,
      errors,
    });
  } catch (error) {
    return failure(error);
  }
});

/** What one Apify review scrape is allowed to spend, mirroring `_shared/reviews.ts`. */
function reviewScrapeCostUsd(): number {
  const configured = Number(getEnv("APIFY_MAX_CHARGE_USD") ?? 0.25);
  return Number.isFinite(configured) && configured > 0 ? configured : 0.25;
}

/**
 * Refuses the read when the reader that would pay for it is out of allowance.
 * SerpApi is billed per search and Apify per dollar, so each is checked its own way.
 */
async function assertReaderBudget(
  db: Db,
  businessId: string,
  reader: "serpapi" | "apify",
  searches: number,
): Promise<void> {
  if (reader === "serpapi") {
    const budget = await readBudget(db, businessId, "serpapi");
    if (affordableCount(budget.remaining, 1) < searches) {
      throw new HttpError(429, budgetMessage("serpapi", budget, searches));
    }
    return;
  }

  const spend = await readSpend(db, businessId, "apify");
  const needed = reviewScrapeCostUsd();
  if (spend.remainingUsd < needed) throw new HttpError(429, spendMessage(spend, needed));
}

/**
 * Reviews for one Apify-backed profile.
 *
 * A scrape that outlives our wait is **kept, not discarded**: its run id is
 * stored on the connection and the next sync collects it, so one charge buys one
 * scrape instead of buying a fresh run every time the actor is slow. `running:
 * true` means the outcome is still open — the caller counts it and moves on
 * without recording usage, because the charge lands at collection.
 */
async function apifyProfileReviews(
  db: Db,
  businessId: string,
  connection: ConnectionRow,
  limit: number,
): Promise<{ reviews: SyncedReview[]; running: boolean; run: ReviewRun | null }> {
  const pending =
    connection.last_run_id && !reviewRunFinished(connection.last_run_status)
      ? await readReviewScrape(connection.last_run_id)
      : null;

  if (pending && !reviewRunFinished(pending.status)) {
    await saveRunState(db, connection.id, pending);
    return { reviews: [], running: true, run: pending };
  }

  // Collecting a run we already paid for costs nothing new, so the budget is only
  // checked when a run has to be started. Otherwise a workspace sitting at its
  // monthly cap could never collect the scrape it had already been charged for.
  if (!pending) await assertReaderBudget(db, businessId, "apify", 1);

  const run = pending ?? (await startReviewScrape(connection.platform, connection.handle, limit));
  if (!run.id) throw new HttpError(502, "Apify did not return a run id.");

  if (!reviewRunFinished(run.status)) {
    await saveRunState(db, connection.id, run);
    return { reviews: [], running: true, run };
  }

  // Terminal, so it will never produce anything more. Stop tracking it *before*
  // reading it: a run that failed must not stay on the connection and be retried
  // as though it were still working.
  await saveRunState(db, connection.id, null);
  const reviews = await collectReviewScrape(connection.platform, run, limit);
  return { reviews, running: false, run };
}

/** Stores, or with `null` clears, the in-flight run on a connection. */
async function saveRunState(db: Db, connectionId: string, run: ReviewRun | null): Promise<void> {
  await db
    .from("review_connections")
    .update({ last_run_id: run?.id ?? "", last_run_status: run?.status ?? "" })
    .eq("id", connectionId);
}

/**
 * Recomputes the per-source score rows from the reviews we now hold, keeping the
 * previous score so the page can show movement. `my_review_sources` has no unique
 * key, so this reads then writes rather than upserting.
 */
async function refreshSources(
  db: Db,
  businessId: string,
): Promise<{ newReviews: number; averageRating: number; sources: number }> {
  const { data: reviews, error } = await db
    .from("my_reviews")
    .select("source, rating, posted_at")
    .eq("business_id", businessId)
    .limit(EXISTING_LIMIT);
  if (error) throw new HttpError(500, error.message);

  const cutoff = Date.now() - 30 * 86_400_000;
  const grouped = new Map<string, { count: number; sum: number; recent: number }>();
  for (const row of reviews ?? []) {
    const source = String(row.source ?? "");
    if (!source) continue;
    const entry = grouped.get(source) ?? { count: 0, sum: 0, recent: 0 };
    entry.count += 1;
    entry.sum += Number(row.rating ?? 0);
    if (new Date(String(row.posted_at)).getTime() >= cutoff) entry.recent += 1;
    grouped.set(source, entry);
  }

  const { data: existingSources } = await db
    .from("my_review_sources")
    .select("id, source, score")
    .eq("business_id", businessId);
  const priorScore = new Map<string, number>();
  for (const row of existingSources ?? []) {
    priorScore.set(String(row.source), Number(row.score ?? 0));
  }

  const label = reviewTrendLabel();
  let newReviews = 0;
  let weightedSum = 0;
  let weightedCount = 0;

  for (const [source, entry] of grouped) {
    const score = Number((entry.sum / entry.count).toFixed(2));
    newReviews += entry.recent;
    weightedSum += entry.sum;
    weightedCount += entry.count;

    const prior = priorScore.get(source) ?? score;
    const existingRow = (existingSources ?? []).find((r) => String(r.source) === source);
    if (existingRow) {
      const { error: updateError } = await db
        .from("my_review_sources")
        .update({ score, previous_score: prior, reviews: entry.count, new_this_month: entry.recent })
        .eq("id", existingRow.id);
      if (updateError) throw new HttpError(500, updateError.message);
    } else {
      const { error: insertError } = await db.from("my_review_sources").insert({
        business_id: businessId,
        source,
        score,
        previous_score: score,
        reviews: entry.count,
        new_this_month: entry.recent,
      });
      if (insertError) throw new HttpError(500, insertError.message);
    }

    await upsertSeriesPoint(db, businessId, source, label, score);
  }

  return {
    newReviews,
    averageRating: weightedCount ? Number((weightedSum / weightedCount).toFixed(2)) : 0,
    sources: grouped.size,
  };
}

/**
 * One trend point per (source, day): update today's, insert on a new day.
 *
 * The day granularity is deliberate — a month label meant a workspace's first
 * weeks of scanning produced a single bar, with nothing to compare it against.
 * The series is then trimmed to `REVIEW_TREND_WINDOW` days so it stays a chart a
 * person can read rather than a year of columns.
 */
async function upsertSeriesPoint(
  db: Db,
  businessId: string,
  source: string,
  label: string,
  score: number,
): Promise<void> {
  const { data: existing } = await db
    .from("my_review_series")
    .select("id")
    .eq("business_id", businessId)
    .eq("source", source)
    .eq("label", label)
    .limit(1);

  const row = (existing ?? [])[0];
  if (row) {
    await db.from("my_review_series").update({ score }).eq("id", row.id);
    return;
  }

  const { data: all } = await db
    .from("my_review_series")
    .select("sort_order")
    .eq("business_id", businessId)
    .eq("source", source)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = Number((all ?? [])[0]?.sort_order ?? 0) + 1;

  await db
    .from("my_review_series")
    .insert({ business_id: businessId, source, label, score, sort_order: nextOrder });

  // Age out the days past the window. A new point is the only thing that can
  // grow the series, so pruning here is enough to hold it at the window.
  const { data: recent } = await db
    .from("my_review_series")
    .select("sort_order")
    .eq("business_id", businessId)
    .eq("source", source)
    .order("sort_order", { ascending: false })
    .limit(REVIEW_TREND_WINDOW);
  const orders = (recent ?? []).map((point) => Number(point.sort_order ?? 0));
  if (orders.length >= REVIEW_TREND_WINDOW) {
    const cutoff = orders[orders.length - 1];
    const { error: trimError } = await db
      .from("my_review_series")
      .delete()
      .eq("business_id", businessId)
      .eq("source", source)
      .lt("sort_order", cutoff);
    if (trimError) throw new HttpError(500, trimError.message);
  }
}

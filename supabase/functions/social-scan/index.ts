import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv, hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import { clampInt } from "../_shared/keywords.ts";
import {
  SOCIAL_PLATFORMS,
  actorFor,
  engagementRate,
  fetchDatasetItems,
  followersFrom,
  inputFor,
  isTerminal,
  normalisePosts,
  platformOf,
  startRun,
  waitForRun,
  type ApifyRun,
  type SocialPlatform,
} from "../_shared/apify.ts";
import {
  bestBenchmarkByPlatform,
  scoreOwnProfile,
  type CompetitorPostRow,
  type CompetitorSocialRow,
} from "../_shared/socialScore.ts";

/**
 * Competitor social scan (Apify).
 *
 * For each competitor handle the workspace already records, this starts one
 * Apify actor run, waits a bounded while for it, and stores whatever public
 * posts came back as **signal** — captions, engagement, media URLs. Nothing
 * here republishes competitor creative; the app only ever builds original ads.
 *
 * Cost safety, in layers:
 *   - per run: `maxItems` caps charged results and `maxTotalChargeUsd` caps the
 *     spend, both configurable and both sent to Apify itself;
 *   - per workspace per month: `readSpend()` against `APIFY_MONTHLY_CHARGE_USD`,
 *     which also tightens the per-run ceiling to whatever is left;
 *   - per invocation: a hard cap on how many targets we touch.
 *
 * A run that outlives our wait is not thrown away: its id is stored on the
 * target and the next scan collects it before starting anything new. That is
 * also where the Phase 3/4 `provider-webhook` will slot in.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  competitorId?: string;
  platforms?: string[];
  limit?: number;
  /** Scrape even when the cadence says the target is not due yet. */
  force?: boolean;
  /** `onlyPostsNewerThan` override (a date, or e.g. "2 weeks"). */
  since?: string;
}

interface CompetitorRow {
  id: string;
  name: string;
  cadence: string;
}

interface SocialRow {
  competitor_id: string;
  platform: string;
  handle: string;
  followers: number;
}

interface TargetRow {
  id: string;
  competitor_id: string;
  platform: string;
  last_scraped_at: string | null;
  last_run_id: string;
  last_run_status: string;
}

/** One handle we intend to scrape, with the state of its last scrape. */
interface Target {
  competitorId: string;
  name: string;
  platform: SocialPlatform;
  handle: string;
  followers: number;
  since: string;
  state?: TargetRow;
}

/**
 * Scrape state for one of the workspace's **own** handles.
 *
 * Own profiles have no competitor row to hang off, so they use
 * `social_monitor_targets` with `competitor_id` null — the same table, the same
 * "one run is kept and collected" guarantee. The unique index does not cover a
 * null competitor, so the row is found and updated by id rather than upserted.
 */
interface OwnTargetState {
  id: string;
  platform: string;
  last_scraped_at: string | null;
  last_run_id: string;
  last_run_status: string;
  last_error: string;
  /** Bumped by the table's trigger on every write, including a failed one. */
  updated_at: string | null;
}

/** Hard caps per invocation and per run, so a scan cannot run away. */
const MAX_TARGETS = 5;
const DEFAULT_TARGETS = 2;
const DEFAULT_MAX_ITEMS = 30;
const MIN_CHARGE_USD = 0.01;
/**
 * Most posts one follower-count correction will restate in a single run. A cap
 * keeps a workspace with a long post history from turning one scan into an
 * unbounded write loop; the next run continues where this one stopped.
 */
const RESTATE_LIMIT = 500;
/** How long we will wait across all the runs we started, in total. */
const WAIT_BUDGET_MS = 90_000;

/**
 * How many of the workspace's own profiles one invocation scores.
 *
 * Every own read is another Apify run, and the account's monthly allowance is
 * shared with competitor scanning. Two per pull keeps the pass cheap while still
 * working through a workspace's handles over a few pulls — the least recently
 * scored platforms go first.
 */
const MAX_OWN_TARGETS = 2;

/**
 * How long an own profile is left alone after it is read. Deliberately not tied
 * to a competitor's cadence: a pull forces the competitor scan (`force: true`),
 * and honouring that here would re-buy every own read on every pull.
 */
const OWN_CADENCE_HOURS = 20;

/**
 * How long a profile we could not read is left alone before it is tried again.
 *
 * Shorter than the cadence on purpose. A refusal costs nothing — the run is
 * rejected before it starts — so a transient one should recover the same day.
 * What matters is that a *permanent* refusal (a platform whose actor demands a
 * larger minimum charge than the workspace allows) stops being retried first on
 * every pull and holding one of the `MAX_OWN_TARGETS` slots, which would starve
 * the profiles that can actually be read.
 */
const OWN_ERROR_RETRY_HOURS = 6;

/** How long the own pass waits for one run before the next scan collects it. */
const OWN_WAIT_SECONDS = 45;

/** How long a cadence keeps a target "not due yet". */
const CADENCE_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 6 * 24,
  monthly: 26 * 24,
};

/** A positive number from the environment, or the fallback. */
function positiveNumberEnv(key: string, fallback: number): number {
  const value = Number(getEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isDue(lastScrapedAt: string | null, cadence: string): boolean {
  if (!lastScrapedAt) return true;
  const window = CADENCE_HOURS[cadence] ?? CADENCE_HOURS.weekly;
  const elapsedHours = (Date.now() - new Date(lastScrapedAt).getTime()) / 3_600_000;
  return !Number.isFinite(elapsedHours) || elapsedHours >= window;
}

/** Private or removed profiles are a normal outcome, not a broken scan. */
function isSkipMessage(message: string): boolean {
  return /private|not found|does not exist|unavailable|no posts|empty/i.test(message);
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // Held in the handler scope (not the try) so the helper functions below, which
  // run only after the caller has been authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let businessId = "";

  try {
    if (!hasEnv("APIFY_TOKEN")) {
      throw new HttpError(409, "Apify is not configured on the server. Add APIFY_TOKEN.");
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    db = adminClient();
    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    const maxItems = clampInt(getEnv("APIFY_MAX_ITEMS"), 1, 500, DEFAULT_MAX_ITEMS);
    const configuredCharge = positiveNumberEnv("APIFY_MAX_CHARGE_USD", 0.25);

    /* ----------------------------------------------------------- targets */

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, social_handles")
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name, cadence")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);
    const competitors = (competitorRows ?? []) as CompetitorRow[];
    if (!competitors.length) {
      throw new HttpError(
        409,
        "No competitors to watch yet. Add competitor websites, then run the scan again.",
      );
    }
    const competitorById = new Map(competitors.map((c) => [c.id, c]));

    // The handles the workspace has declared are the monitoring list — one row
    // per competitor per platform, added on Competition → Social presence. The
    // targets table only stores how each of them was last scraped.
    const { data: socialRows, error: socialError } = await db
      .from("competitor_social")
      .select("competitor_id, platform, handle, followers")
      .in(
        "competitor_id",
        competitors.map((c) => c.id),
      );
    if (socialError) throw new HttpError(500, socialError.message);

    const { data: stateRows, error: stateError } = await db
      .from("social_monitor_targets")
      .select("id, competitor_id, platform, last_scraped_at, last_run_id, last_run_status")
      .eq("business_id", businessId);
    if (stateError) throw new HttpError(500, stateError.message);

    const stateByKey = new Map<string, TargetRow>();
    for (const row of (stateRows ?? []) as TargetRow[]) {
      stateByKey.set(`${row.competitor_id}|${row.platform}`, row);
    }

    const wanted = new Set<SocialPlatform>();
    for (const value of body.platforms ?? []) {
      const platform = platformOf(String(value));
      if (platform) wanted.add(platform);
    }

    const skipped: { handle: string; reason: string }[] = [];
    const due: Target[] = [];

    for (const row of (socialRows ?? []) as SocialRow[]) {
      const label = `${row.platform} ${row.handle}`.trim();
      const platform = platformOf(String(row.platform ?? ""));

      if (!platform) {
        skipped.push({ handle: label, reason: "no scraper for this platform" });
        continue;
      }
      if (body.competitorId && row.competitor_id !== body.competitorId) continue;
      if (wanted.size && !wanted.has(platform)) continue;
      if (!actorFor(platform)) {
        skipped.push({
          handle: label,
          reason: `${SOCIAL_PLATFORMS[platform].envKey} is not set on the server`,
        });
        continue;
      }

      const competitor = competitorById.get(row.competitor_id);
      if (!competitor) continue;

      const state = stateByKey.get(`${row.competitor_id}|${platform}`);
      if (!body.force && state && !isDue(state.last_scraped_at, competitor.cadence)) {
        skipped.push({
          handle: label,
          reason: `not due yet (${competitor.cadence} cadence — send force to scrape anyway)`,
        });
        continue;
      }

      due.push({
        competitorId: row.competitor_id,
        name: competitor.name,
        platform,
        handle: String(row.handle ?? ""),
        followers: Number(row.followers ?? 0),
        // Incremental by default: posts newer than the last successful scrape,
        // so a repeat scan is cheap and still catches everything new.
        since: body.since ?? state?.last_scraped_at?.slice(0, 10) ?? "1 month",
        state,
      });
    }

    const limit = clampInt(body.limit, 1, MAX_TARGETS, DEFAULT_TARGETS);
    const selected = due.slice(0, limit);

    /* ------------------------------------------- collect in-flight runs */
    // A previous scan may have left runs working; if they have finished, their
    // posts are ingested now, and their cost is logged once — here, not twice.
    let posts = 0;
    for (const target of due) {
      const runId = target.state?.last_run_id ?? "";
      if (!runId || isTerminal(target.state?.last_run_status ?? "")) continue;
      const run = await waitForRun(runId, 0);
      if (!isTerminal(run.status)) continue;
      posts += await collectRun(run, target, maxItems, checkedAt);
    }

    if (!selected.length) {
      return json({
        scanned: 0,
        posts,
        running: 0,
        capped: false,
        skipped,
        errors: [],
        message: due.length
          ? `Nothing started — a scan starts at most ${limit} target${limit === 1 ? "" : "s"}.`
          : "No monitorable handles are due. Send force to scrape them anyway.",
      });
    }

    /* ------------------------------------------------------------ budget */

    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < MIN_CHARGE_USD) {
      throw new HttpError(429, spendMessage(spend, MIN_CHARGE_USD));
    }
    // Never let one run exceed what the workspace has left for the month.
    const maxChargeUsd = Number(Math.min(configuredCharge, spend.remainingUsd).toFixed(4));

    /* ------------------------------------------------- start the runs */

    const started: { run: ApifyRun; target: Target; actorId: string }[] = [];
    const errors: string[] = [];

    for (const target of selected) {
      try {
        const actorId = actorFor(target.platform);
        const run = await startRun(
          actorId,
          inputFor(target.platform, target.handle, maxItems, target.since),
          {
            maxItems,
            maxTotalChargeUsd: maxChargeUsd,
            // Apify's own kill switch for the run. It is deliberately longer than
            // our wait: a run we stop waiting for keeps working and the next scan
            // collects it.
            timeoutSecs: clampInt(getEnv("APIFY_RUN_TIMEOUT_SECS"), 30, 3600, 300),
          },
        );
        started.push({ run, target, actorId });
        await saveTarget(target, run, "");
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The Apify run could not start.";
        errors.push(`${target.name} (${target.platform}): ${message}`);
        await saveTarget(target, null, message);
      }
    }

    /* -------------------------------------------------- wait and ingest */

    const deadline = Date.now() + WAIT_BUDGET_MS;
    let running = 0;

    for (const { run, target, actorId } of started) {
      let current = run;
      while (!isTerminal(current.status) && Date.now() < deadline) {
        const secondsLeft = Math.floor((deadline - Date.now()) / 1000);
        if (secondsLeft <= 0) break;
        current = await waitForRun(current.id, Math.min(60, secondsLeft));
      }

      if (!isTerminal(current.status)) {
        // Still working: keep the run id on the target so the next scan collects
        // it, and log no usage yet so the cost is only counted once.
        running += 1;
        await saveTarget(target, current, "");
        continue;
      }

      posts += await collectRun(current, target, maxItems, checkedAt);

      // A finished-but-unsuccessful run still costs something, and a private
      // profile is a normal outcome rather than a broken scan.
      if (current.status !== "SUCCEEDED") {
        const detail = `${target.platform} ${target.handle}: ${current.statusMessage ?? current.status}`;
        if (isSkipMessage(current.statusMessage ?? "")) {
          skipped.push({ handle: `${target.platform} ${target.handle}`, reason: detail });
        } else {
          errors.push(`${target.name}: ${detail}`);
        }
        await recordUsage(db, {
          businessId,
          provider: "apify",
          endpoint: `actors/${actorId}`,
          units: 0,
          costUsd: current.usageTotalUsd,
          status: "error",
          detail: detail.slice(0, 300),
        });
      }
    }

    const scanned = started.length;

    /* ------------------------------------- score the workspace's own handles */
    // The Social & reviews page promises that "the next scan will score" the
    // workspace's own handles, and until this pass existed nothing wrote
    // `social_scores` — so the panel showed its empty state however many handles
    // were declared. It runs after the competitor reads because it compares each
    // own profile against the best rival we just measured.
    const own = await scoreOwnHandles(maxItems, configuredCharge, competitors);

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "social",
      source_name: "Competitor social scan",
      // A run that captured posts did its job even if one target errored; the
      // per-target reason belongs on `error`, not on the status, or the health
      // panel calls a working scan broken and hides the posts it did collect.
      status: errors.length && !posts ? "failed" : "succeeded",
      changes_found: posts,
      // The reason, not just the fact: the health panel shows this text, and a
      // null error leaves it guessing ("the provider did not return a result").
      error:
        errors.length || own.errors.length
          ? [...errors, ...own.errors].slice(0, 3).join(" · ").slice(0, 500)
          : null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    if (!scanned && !posts && errors.length) throw new HttpError(502, errors[0]);

    return json({
      scanned,
      posts,
      running,
      /** Own profiles this run scored into `social_scores`. */
      scored: own.scored,
      /** Own profiles whose run is still working; the next scan collects them. */
      ownRunning: own.running,
      /** True when the per-scan target limit, not the cadence, cut the list short. */
      capped: due.length > selected.length,
      /** True when the monthly allowance lowered the per-run spend ceiling. */
      spendLimited: maxChargeUsd < configuredCharge,
      skipped,
      errors,
      /** Non-fatal reasons the own pass could not score a profile, named per handle. */
      ownErrors: own.errors,
    });
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * Reads a finished run's dataset, normalises the posts and upserts them, then
   * records the run's usage exactly once, with the cost Apify reported.
   */
  async function collectRun(
    run: ApifyRun,
    target: Target,
    maxItems: number,
    checkedAt: string,
  ): Promise<number> {
    if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
      // Nothing to read — the caller logs the failure and its cost.
      await saveTarget(target, run, "");
      return 0;
    }

    const items = await fetchDatasetItems(run.defaultDatasetId, maxItems);
    const normalised = normalisePosts(items, target.platform);

    // The scrape dataset is the only place a profile's follower count ever comes
    // from, so it is read here and written back onto the monitored handle. This
    // has to happen before the posts are mapped: the engagement rate is a ratio
    // against this figure, and a stale zero makes every post read as 0%.
    const followers = followersFrom(items);
    if (followers !== null) {
      if (followers !== target.followers) {
        target.followers = followers;
        const { error: followersError } = await db
          .from("competitor_social")
          .update({ followers })
          .eq("business_id", businessId)
          .eq("competitor_id", target.competitorId)
          .eq("platform", target.platform);
        if (followersError) throw new HttpError(500, followersError.message);
      }

      // Restated on every scan that learns a count, not only when the count
      // changed. Posts captured before one was known are stored at 0%, and they
      // disagree with the count now on file whatever this run's figure is —
      // `restateEngagement` skips the rows already right, so the steady state
      // costs one read and no writes.
      await restateEngagement(target.competitorId, target.platform, followers);
    }

    if (normalised.length) {
      const { error } = await db.from("social_posts").upsert(
        normalised.map((post) => ({
          business_id: businessId,
          competitor_id: target.competitorId,
          platform: target.platform,
          external_id: post.externalId,
          url: post.url,
          caption: post.caption,
          media_url: post.mediaUrl,
          media_type: post.mediaType,
          hashtags: post.hashtags,
          mentions: post.mentions,
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
          views: post.views,
          engagement_rate: engagementRate(post.likes, post.comments, target.followers),
          posted_at: post.postedAt,
          scraped_at: checkedAt,
        })),
        { onConflict: "business_id,platform,external_id" },
      );
      if (error) throw new HttpError(500, error.message);
    }

    await recordUsage(db, {
      businessId,
      provider: "apify",
      endpoint: "actors",
      units: normalised.length,
      costUsd: run.usageTotalUsd,
      detail: `${target.platform} ${target.handle}: ${normalised.length} posts`,
    });

    await saveTarget(target, run, "");
    return normalised.length;
  }

  /**
   * Recomputes the stored engagement rate for posts already on file.
   *
   * The rate is a ratio against the follower count, so the moment that count is
   * corrected, every stored rate derived from the old one is wrong. Only the
   * posts for this competitor and platform are touched, and only when the count
   * actually changed — so a run that learns nothing new writes nothing.
   */
  async function restateEngagement(
    competitorId: string,
    platform: string,
    followers: number,
  ): Promise<void> {
    const { data, error } = await db
      .from("social_posts")
      .select("id, likes, comments, engagement_rate")
      .eq("business_id", businessId)
      .eq("competitor_id", competitorId)
      .eq("platform", platform)
      // Newest first, so what the Social tab actually shows is corrected first
      // when a workspace holds more posts than one run will restate.
      .order("scraped_at", { ascending: false })
      .limit(RESTATE_LIMIT);
    if (error) throw new HttpError(500, error.message);

    for (const row of data ?? []) {
      const rate = engagementRate(Number(row.likes ?? 0), Number(row.comments ?? 0), followers);
      if (Number(row.engagement_rate ?? 0) === rate) continue;
      const { error: updateError } = await db
        .from("social_posts")
        .update({ engagement_rate: rate })
        .eq("id", row.id);
      if (updateError) throw new HttpError(500, updateError.message);
    }
  }

  /** Upserts the scrape state for one handle. */
  async function saveTarget(target: Target, run: ApifyRun | null, error: string): Promise<void> {
    const finished = run !== null && isTerminal(run.status);
    const { error: upsertError } = await db.from("social_monitor_targets").upsert(
      {
        business_id: businessId,
        competitor_id: target.competitorId,
        platform: target.platform,
        handle: target.handle,
        actor_id: actorFor(target.platform),
        last_scraped_at: finished
          ? new Date().toISOString()
          : (target.state?.last_scraped_at ?? null),
        // A run we failed to start leaves the previous run id in place: it may
        // still be the one the next scan wants to collect.
        last_run_id: run?.id ?? target.state?.last_run_id ?? "",
        last_run_status: run?.status ?? target.state?.last_run_status ?? "",
        last_error: error,
      },
      { onConflict: "business_id,competitor_id,platform" },
    );
    if (upsertError) throw new HttpError(500, upsertError.message);
  }

  /**
   * Scores the workspace's **own** social profiles into `social_scores`.
   *
   * The page's empty state has always said "add your handles and the next scan
   * will score them", but no scan did. The handles live in
   * `businesses.social_handles` (a platform → handle map); each one we have an
   * actor for is read, compared with the best rival measured on the same
   * platform, and stored. Bounded two ways: at most `MAX_OWN_TARGETS` profiles
   * per invocation, and each not re-read more than once per
   * `OWN_CADENCE_HOURS`, so this cannot turn one pull into seven billed runs.
   *
   * A run that outlives its wait is kept on `social_monitor_targets` (with a null
   * `competitor_id`) and collected on the next scan, exactly as a competitor's is.
   */
  async function scoreOwnHandles(
    maxItems: number,
    configuredCharge: number,
    competitorRows: CompetitorRow[],
  ): Promise<{ scored: number; running: number; errors: string[] }> {
    const { data: businessRow } = await db
      .from("businesses")
      .select("social_handles")
      .eq("id", businessId)
      .single();
    const handles = (businessRow?.social_handles ?? {}) as Record<string, string>;

    // One handle per platform: a user who added both "X" and "Twitter" entries
    // gets one read, not two for the same profile.
    const ownByPlatform = new Map<SocialPlatform, string>();
    for (const [label, raw] of Object.entries(handles)) {
      const platform = platformOf(label);
      if (!platform || !actorFor(platform) || ownByPlatform.has(platform)) continue;
      const handle = String(raw ?? "").trim();
      if (handle) ownByPlatform.set(platform, handle);
    }
    if (!ownByPlatform.size) return { scored: 0, running: 0, errors: [] };

    const { data: stateRows } = await db
      .from("social_monitor_targets")
      .select("id, platform, last_scraped_at, last_run_id, last_run_status, last_error, updated_at")
      .eq("business_id", businessId)
      .is("competitor_id", null);
    const stateByPlatform = new Map<SocialPlatform, OwnTargetState>();
    for (const row of (stateRows ?? []) as OwnTargetState[]) {
      const platform = platformOf(String(row.platform ?? ""));
      if (platform) stateByPlatform.set(platform, row);
    }

    const { data: scoreRows } = await db
      .from("social_scores")
      .select("id, platform, followers")
      .eq("business_id", businessId);
    const existingScores = (scoreRows ?? []) as {
      id: string;
      platform: string;
      followers: number;
    }[];

    // The rival each own profile is set against, from reads already on file.
    const names = new Map(competitorRows.map((row) => [row.id, row.name]));
    const { data: benchSocial } = await db
      .from("competitor_social")
      .select("competitor_id, platform, followers")
      .eq("business_id", businessId);
    const { data: benchPosts } = await db
      .from("social_posts")
      .select("competitor_id, platform, likes, comments, engagement_rate")
      .eq("business_id", businessId)
      .limit(2000);
    const benchmarks = bestBenchmarkByPlatform(
      (benchSocial ?? []) as CompetitorSocialRow[],
      (benchPosts ?? []) as CompetitorPostRow[],
      names,
    );

    const now = Date.now();
    const due = [...ownByPlatform.entries()]
      .map(([platform, handle]) => ({ platform, handle, state: stateByPlatform.get(platform) }))
      .filter(({ state }) => {
        // A run we have not collected yet is always worth collecting, however
        // recently the profile was scored — its money is already spent.
        if (state?.last_run_id && !isTerminal(state.last_run_status)) return true;
        // A failed read leaves `last_scraped_at` untouched, so for one of those
        // the last attempt is the row's `updated_at`, which the table's trigger
        // bumps on every write. Falling back to it is what gives a refused
        // profile a cadence clock instead of an infinite "due now".
        const attemptedAt = state?.last_scraped_at ?? state?.updated_at ?? null;
        if (!attemptedAt) return true;
        const hours = (now - new Date(attemptedAt).getTime()) / 3_600_000;
        if (!Number.isFinite(hours)) return true;
        return hours >= (state?.last_error ? OWN_ERROR_RETRY_HOURS : OWN_CADENCE_HOURS);
      })
      .sort(
        (a, b) =>
          (a.state?.last_scraped_at ? Date.parse(a.state.last_scraped_at) : 0) -
          (b.state?.last_scraped_at ? Date.parse(b.state.last_scraped_at) : 0),
      )
      .slice(0, MAX_OWN_TARGETS);

    if (!due.length) return { scored: 0, running: 0, errors: [] };

    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < MIN_CHARGE_USD) {
      // Not an error worth surfacing: the competitor pass already reports the
      // budget refusal, and leaving own scores for a later scan loses nothing.
      return { scored: 0, running: 0, errors: [] };
    }
    const ownCharge = Number(Math.min(configuredCharge, spend.remainingUsd).toFixed(4));

    const errors: string[] = [];
    let scored = 0;
    let running = 0;

    for (const target of due) {
      // Declared outside the try so the catch can persist a run we did start:
      // its id must survive, or the next scan has no way to collect it.
      let run: ApifyRun | null = null;
      try {
        if (target.state?.last_run_id && !isTerminal(target.state.last_run_status)) {
          run = await waitForRun(target.state.last_run_id, 0);
        }
        if (!run) {
          run = await startRun(
            actorFor(target.platform),
            inputFor(target.platform, target.handle, maxItems, "1 month"),
            {
              maxItems,
              maxTotalChargeUsd: ownCharge,
              timeoutSecs: clampInt(getEnv("APIFY_RUN_TIMEOUT_SECS"), 30, 3600, 300),
            },
          );
        }
        if (!isTerminal(run.status)) run = await waitForRun(run.id, OWN_WAIT_SECONDS);
        if (!isTerminal(run.status)) {
          running += 1;
          await saveOwnState(target, run, "");
          continue;
        }

        if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
          const detail = run.statusMessage ?? run.status;
          await saveOwnState(target, run, detail);
          await recordUsage(db, {
            businessId,
            provider: "apify",
            endpoint: "actors",
            units: 0,
            costUsd: run.usageTotalUsd,
            status: "error",
            detail: `own ${target.platform} ${target.handle}: ${detail}`.slice(0, 300),
          });
          errors.push(`own ${target.platform} ${target.handle}: ${detail}`);
          continue;
        }

        const items = await fetchDatasetItems(run.defaultDatasetId, maxItems);
        const followers = followersFrom(items);
        const posts = normalisePosts(items, target.platform);
        await saveOwnState(target, run, "");

        await recordUsage(db, {
          businessId,
          provider: "apify",
          endpoint: "actors",
          units: posts.length,
          costUsd: run.usageTotalUsd,
          detail: `own ${target.platform} ${target.handle}: ${posts.length} posts`,
        });

        // A dataset that never states a follower count is unknown, not zero. A
        // score built on a stand-in zero would read as "you have no audience"
        // and overwrite a figure the previous scan measured.
        if (followers === null) {
          errors.push(
            `own ${target.platform} ${target.handle}: the scrape did not report a follower count`,
          );
          continue;
        }

        const engagement = posts.length
          ? posts.reduce(
              (sum, post) => sum + engagementRate(post.likes, post.comments, followers),
              0,
            ) / posts.length
          : 0;

        const previous = existingScores.find(
          (row) => platformOf(String(row.platform ?? "")) === target.platform,
        );
        const score = scoreOwnProfile(
          { platform: target.platform, handle: target.handle, followers, engagement },
          benchmarks.get(target.platform) ?? null,
          Number(previous?.followers ?? 0),
        );
        const payload = {
          business_id: businessId,
          platform: score.platform,
          handle: score.handle,
          score: score.score,
          followers: score.followers,
          growth: score.growth,
          benchmark_gap: score.benchmarkGap,
          focus: score.focus,
          reason: score.reason,
        };
        const write = previous
          ? await db.from("social_scores").update(payload).eq("id", previous.id)
          : await db.from("social_scores").insert(payload);
        if (write.error) throw new HttpError(500, write.error.message);
        scored += 1;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The own-profile read failed.";
        errors.push(`own ${target.platform} ${target.handle}: ${message}`);
        // Persist the failure, so it starts the retry clock above. A refused run
        // never reaches the success path, and an unrecorded refusal is exactly
        // what lets one unscorable platform eat a slot on every single scan.
        try {
          await saveOwnState(target, run, message);
        } catch {
          // The read error is the one worth reporting; a state write that also
          // fails must not be allowed to hide it.
        }
      }
    }

    return { scored, running, errors };
  }

  /** Stores one own profile's scrape state, updating the row when one exists. */
  async function saveOwnState(
    target: { platform: SocialPlatform; handle: string; state?: OwnTargetState },
    run: ApifyRun | null,
    error: string,
  ): Promise<void> {
    const finished = run !== null && isTerminal(run.status);
    const row = {
      business_id: businessId,
      competitor_id: null,
      platform: target.platform,
      handle: target.handle,
      actor_id: actorFor(target.platform),
      last_scraped_at: finished
        ? new Date().toISOString()
        : (target.state?.last_scraped_at ?? null),
      last_run_id: run?.id ?? target.state?.last_run_id ?? "",
      last_run_status: run?.status ?? target.state?.last_run_status ?? "",
      last_error: error,
    };
    const write = target.state?.id
      ? await db.from("social_monitor_targets").update(row).eq("id", target.state.id)
      : await db.from("social_monitor_targets").insert(row);
    if (write.error) throw new HttpError(500, write.error.message);
  }
});

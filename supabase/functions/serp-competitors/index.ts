import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { affordableCount, budgetMessage, readBudget } from "../_shared/budget.ts";
import { DEFAULT_KEYWORDS, MAX_KEYWORDS, clampInt, resolveKeywords } from "../_shared/keywords.ts";
import { standingsByKeyword, summariseRankings, type RankingRow } from "../_shared/seo.ts";
import {
  findOrganicResult,
  hostnameOf,
  localResultsOf,
  matchLocalPlace,
  organicResultsOf,
  serpApi,
  type SerpApiLocalResult,
  type SerpApiResponse,
} from "../_shared/serpapi.ts";

/**
 * Competitor benchmarking (SerpApi).
 *
 * One organic search per tracked keyword gives every business's presence in the
 * Google top 10, which becomes the **Share of Voice** comparison. The same
 * responses give every competitor's rank for every tracked term, which is the
 * **Keyword Gap** (`competitor_keywords`) — recorded here because the searches are
 * already bought; a second pass over the same terms would bill them twice. One
 * Maps search per competitor supplies rating and review counts for the
 * **Competitor Review Gap**. Results replace the tenant's previous row so the panel
 * is always current.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
const TOP_N = 10;

/** How many months of review-trend history each competitor keeps. */
const REVIEW_TREND_WINDOW_MONTHS = 18;

interface Body {
  businessId?: string;
  keywords?: string[];
  location?: string;
  limit?: number;
}

interface CompetitorRow {
  id: string;
  name: string;
  website: string;
  /**
   * The rating we already hold, read back so `previous_rating` keeps a real earlier
   * figure. Overwriting it with the new value would make every movement read as none.
   */
  rating: number | null;
  review_count: number | null;
}

/** Everything one competitor's own reads just produced, in one update. */
interface CompetitorUpdate {
  id: string;
  rating: number;
  previous_rating: number;
  review_count: number;
  reviews_this_month: number;
  /**
   * 0–100 search visibility, derived from the top-10 reads this run already paid
   * for — see the note where it is computed.
   */
  seo_score: number;
}

/** Best local result for a business: explicit place, matched listing, else first. */
function pickPlace(
  response: SerpApiResponse,
  domain: string,
  name: string,
): SerpApiLocalResult | undefined {
  if (response.place_results) return response.place_results;
  const candidates = localResultsOf(response);
  return candidates.find((entry) => matchLocalPlace(entry, domain, name)) ?? candidates[0];
}

/** Percent of tracked terms a business appears in the top 10 for. */
function sharePct(count: number, terms: number): number {
  if (!terms) return 0;
  return Number(((count / terms) * 100).toFixed(2));
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!hasEnv("SERPAPI_KEY")) {
      throw new HttpError(
        409,
        "SerpApi is not configured on the server. Add SERPAPI_KEY to the function secrets.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const db = adminClient();
    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, brand_name, primary_domain, country")
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const brandName = String(business.brand_name ?? "");
    const ourDomain = hostnameOf(String(business.primary_domain ?? ""));
    const location = String(body.location ?? business.country ?? "").trim();

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name, website, rating, review_count")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);

    const competitors = (competitorRows ?? []) as CompetitorRow[];
    if (!competitors.length) {
      throw new HttpError(
        409,
        "No competitors to benchmark yet. Add competitor websites, then run the benchmark again.",
      );
    }

    const allKeywords = await resolveKeywords(db, businessId, body.keywords);
    if (!allKeywords.length) {
      throw new HttpError(
        409,
        "No tracked keywords yet. Find some keywords on My Business, then run the benchmark again.",
      );
    }
    const requested = Math.min(
      clampInt(body.limit, 1, MAX_KEYWORDS, DEFAULT_KEYWORDS),
      allKeywords.length,
    );

    // One organic search per keyword, plus a Maps lookup for us and one per
    // competitor — planned before the first call so the run cannot overshoot
    // the workspace's monthly budget.
    const unitsPerKeyword = 1;
    const mapsReserve = 1 + competitors.length;
    const budget = await readBudget(db, businessId, "serpapi");
    const affordable = affordableCount(budget.remaining, unitsPerKeyword, mapsReserve);
    if (affordable < 1) {
      throw new HttpError(429, budgetMessage("serpapi", budget, unitsPerKeyword + mapsReserve));
    }

    const keywords = allKeywords.slice(0, Math.min(requested, affordable));
    const capped = keywords.length < requested;

    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    /* ---------------------------------------------------- Share of Voice */
    const ourTop10 = { count: 0 };
    const theirTop10 = new Map<string, number>();
    for (const competitor of competitors) theirTop10.set(competitor.id, 0);

    // Search volume is ours to know — an organic response carries no volume — so it
    // comes from the tracked terms, which is the same figure the keyword list shows.
    const { data: volumeRows } = await db
      .from("my_keywords")
      .select("keyword, volume")
      .eq("business_id", businessId);
    const volumeByKeyword = new Map<string, number>();
    for (const row of volumeRows ?? []) {
      volumeByKeyword.set(String(row.keyword ?? "").trim().toLowerCase(), Number(row.volume ?? 0));
    }

    const keywordRows: Record<string, unknown>[] = [];
    /** One standing per tracked term per competitor, for the SEO score below. */
    const standingsByCompetitor = new Map<string, RankingRow[]>();

    for (const keyword of keywords) {
      const response = await serpApi({
        engine: "google",
        q: keyword,
        location: location || undefined,
        device: "desktop",
        num: 20,
        hl: "en",
      });
      const results = organicResultsOf(response);

      const ours = findOrganicResult(results, ourDomain, brandName);
      if (ours?.position !== undefined && ours.position <= TOP_N) ourTop10.count += 1;

      for (const competitor of competitors) {
        const domain = hostnameOf(String(competitor.website ?? ""));
        const match = findOrganicResult(results, domain, String(competitor.name ?? ""));
        if (match?.position !== undefined && match.position <= TOP_N) {
          theirTop10.set(competitor.id, (theirTop10.get(competitor.id) ?? 0) + 1);
        }

        // One row per term per competitor whether or not either side ranked: a term
        // we place for and they do not *is* the gap, and keeping only the ranked
        // side would hide exactly what the panel exists to show.
        //
        // `difficulty` and `intent` are left null rather than defaulted. An organic
        // response carries neither, and a manufactured number would read on the page
        // as something we measured.
        keywordRows.push({
          business_id: businessId,
          competitor_id: competitor.id,
          keyword,
          volume: volumeByKeyword.get(keyword.trim().toLowerCase()) ?? 0,
          our_rank: ours?.position ?? null,
          their_rank: match?.position ?? null,
        });

        // Kept for the competitor's SEO score: how they place across the tracked
        // set, term by term. A term they do not rank for is recorded as such rather
        // than dropped, so the score reflects the whole tracked list.
        const standings = standingsByCompetitor.get(competitor.id) ?? [];
        standings.push({
          keyword,
          position: match?.position ?? null,
          is_rich_result: Boolean(match?.rich_snippet || match?.rich_snippet_table),
        });
        standingsByCompetitor.set(competitor.id, standings);
      }
    }

    /* ------------------------------------------- their search visibility score */
    // The Competition page's SEO tile reads `competitors.seo_score`, and nothing
    // wrote it: it sat at null while ours moved, so the tile compared our score
    // against a blank. The standings above come from searches this run has already
    // bought, so the score costs nothing extra — and it is the *same* derivation
    // `serp-scan` applies to us, which is what makes the two numbers comparable.
    const seoScoreById = new Map<string, number>();
    for (const competitor of competitors) {
      const rows = standingsByCompetitor.get(competitor.id) ?? [];
      seoScoreById.set(competitor.id, summariseRankings(standingsByKeyword(rows)).seoScore);
    }

    const termCount = keywords.length;
    const ourShare = sharePct(ourTop10.count, termCount);

    // Snapshot our previous share so the app can alert when it crosses the
    // threshold (the upsert below overwrites the current row).
    const { data: priorSov } = await db
      .from("competitor_share_of_voice")
      .select("competitor_id, our_share")
      .eq("business_id", businessId);
    const priorShare = new Map<string, number>();
    for (const row of priorSov ?? []) {
      priorShare.set(String(row.competitor_id), Number(row.our_share ?? 0));
    }

    // The same snapshot for the review gap, so a widening gap can raise its own
    // alert (Phase 3) once this row is replaced below.
    const { data: priorGap } = await db
      .from("competitor_review_gap")
      .select("competitor_id, review_gap")
      .eq("business_id", businessId);
    const priorGapById = new Map<string, number>();
    for (const row of priorGap ?? []) {
      priorGapById.set(String(row.competitor_id), Number(row.review_gap ?? 0));
    }

    const sovRows = competitors.map((competitor) => ({
      business_id: businessId,
      competitor_id: competitor.id,
      competitor_name: String(competitor.name ?? ""),
      keyword_set: "tracked",
      term_count: termCount,
      our_top10: ourTop10.count,
      their_top10: theirTop10.get(competitor.id) ?? 0,
      our_share: ourShare,
      their_share: sharePct(theirTop10.get(competitor.id) ?? 0, termCount),
      previous_our_share: priorShare.has(competitor.id) ? priorShare.get(competitor.id) : null,
      checked_at: checkedAt,
    }));

    /* ------------------------------------------------ Competitor Review Gap */
    const oursMaps = await serpApi({
      engine: "google_maps",
      type: "search",
      q: `${brandName} ${location}`.trim(),
      hl: "en",
    });
    const ourPlace = pickPlace(oursMaps, ourDomain, brandName);

    const gapRows: Record<string, unknown>[] = [];
    // The review count in each Maps lookup is also a review-*trend* point, so one
    // row per competitor per month accumulates real history out of reads already
    // paid for, rather than costing a second provider call to draw the same chart.
    const metricRows: Record<string, unknown>[] = [];
    const ratingUpdates: CompetitorUpdate[] = [];
    const trendLabel = checkedAt.slice(0, 7);
    const trendSort = (() => {
      const at = new Date(checkedAt);
      return at.getUTCFullYear() * 12 + at.getUTCMonth();
    })();

    // The trend point as it stands *before* this run replaces it, so a competitor's
    // "reviews this month" is the growth since the last benchmark of the same month
    // rather than a lifetime total.
    const { data: priorTrend } = await db
      .from("competitor_metrics")
      .select("competitor_id, value")
      .eq("business_id", businessId)
      .eq("kind", "review_trend")
      .eq("label", trendLabel);
    const priorTrendById = new Map<string, number>();
    for (const row of priorTrend ?? []) {
      priorTrendById.set(String(row.competitor_id), Number(row.value ?? 0));
    }
    let mapsCalls = 1;
    for (const competitor of competitors) {
      const name = String(competitor.name ?? "");
      const domain = hostnameOf(String(competitor.website ?? ""));
      const theirMaps = await serpApi({
        engine: "google_maps",
        type: "search",
        q: `${name} ${location}`.trim(),
        hl: "en",
      });
      mapsCalls += 1;
      const theirPlace = pickPlace(theirMaps, domain, name);

      const ourReviews = Number(ourPlace?.reviews ?? 0);
      const theirReviews = Number(theirPlace?.reviews ?? 0);
      const ourRating = Number(ourPlace?.rating ?? 0);
      const theirRating = Number(theirPlace?.rating ?? 0);

      gapRows.push({
        business_id: businessId,
        competitor_id: competitor.id,
        competitor_name: name,
        place_id: String(theirPlace?.place_id ?? theirPlace?.data_id ?? ""),
        our_reviews: ourReviews,
        their_reviews: theirReviews,
        review_gap: theirReviews - ourReviews,
        our_rating: ourRating,
        their_rating: theirRating,
        rating_gap: Number((ourRating - theirRating).toFixed(2)),
        previous_review_gap: priorGapById.has(competitor.id)
          ? (priorGapById.get(competitor.id) ?? null)
          : null,
        checked_at: checkedAt,
      });

      metricRows.push({
        business_id: businessId,
        competitor_id: competitor.id,
        kind: "review_trend",
        label: trendLabel,
        value: theirReviews,
        sort_order: trendSort,
      });

      // The page's stars and review count are read off the **competitor row**, and
      // this Maps lookup is the only read that ever learns them. Sending them to the
      // gap table alone left the headline figures at zero beside a value we had
      // already paid for, which reads on screen as "not measured" when it was.
      ratingUpdates.push({
        id: competitor.id,
        rating: theirRating,
        previous_rating: Number(competitor.rating ?? 0) || theirRating,
        review_count: theirReviews,
        reviews_this_month: priorTrendById.has(competitor.id)
          ? Math.max(0, theirReviews - (priorTrendById.get(competitor.id) ?? 0))
          : 0,
        seo_score: seoScoreById.get(competitor.id) ?? 0,
      });
    }

    /* ------------------------------------------------------------ persist */
    const { error: sovError } = await db
      .from("competitor_share_of_voice")
      .upsert(sovRows, { onConflict: "business_id,competitor_id" });
    if (sovError) throw new HttpError(500, sovError.message);

    const { error: gapError } = await db
      .from("competitor_review_gap")
      .upsert(gapRows, { onConflict: "business_id,competitor_id" });
    if (gapError) throw new HttpError(500, gapError.message);

    // One update per competitor: every column here is its own, and the id is the
    // only key that names it. `last_scan_at` moves with them — the benchmark *is* a
    // read of this competitor, and the page shows the gap as "Last scan".
    for (const update of ratingUpdates) {
      const { error: ratingError } = await db
        .from("competitors")
        .update({
          rating: update.rating,
          previous_rating: update.previous_rating,
          review_count: update.review_count,
          reviews_this_month: update.reviews_this_month,
          seo_score: update.seo_score,
          last_scan_at: checkedAt,
        })
        .eq("id", update.id)
        .eq("business_id", businessId);
      if (ratingError) throw new HttpError(500, ratingError.message);
    }

    // The gap panel shows the *current* standings, so this run's rows replace the
    // previous ones. Written insert-then-prune rather than delete-then-insert:
    // `competitor_keywords` has no unique key to upsert on, and clearing first would
    // leave the panel empty if the insert then failed. Rows written by this run carry
    // a `created_at` at or after the moment the run started, so pruning below that
    // timestamp removes only the rows it is replacing. Pruning is scoped to the
    // business as well, so a run can never touch another tenant's rows.
    if (keywordRows.length) {
      const { error: keywordError } = await db.from("competitor_keywords").insert(keywordRows);
      if (keywordError) throw new HttpError(500, keywordError.message);

      const { error: pruneError } = await db
        .from("competitor_keywords")
        .delete()
        .eq("business_id", businessId)
        .lt("created_at", startedAt);
      if (pruneError) throw new HttpError(500, pruneError.message);
    }

    // Replace this month's point rather than stacking a second reading of it, so a
    // benchmark re-run in the same month corrects the figure instead of doubling it.
    // Scoped by kind and label as well as tenant, so it can never clear another
    // metric series — the traffic rows a separate writer will add, for instance.
    if (metricRows.length) {
      const { error: metricError } = await db.from("competitor_metrics").insert(metricRows);
      if (metricError) throw new HttpError(500, metricError.message);

      const { error: metricPruneError } = await db
        .from("competitor_metrics")
        .delete()
        .eq("business_id", businessId)
        .eq("kind", "review_trend")
        .eq("label", trendLabel)
        .lt("created_at", startedAt);
      if (metricPruneError) throw new HttpError(500, metricPruneError.message);

      // The trend accrues a point a month and would otherwise grow forever;
      // 18 months is a window the chart can still draw and a person still read.
      const { error: trendWindowError } = await db
        .from("competitor_metrics")
        .delete()
        .eq("business_id", businessId)
        .eq("kind", "review_trend")
        .lt("sort_order", trendSort - REVIEW_TREND_WINDOW_MONTHS);
      if (trendWindowError) throw new HttpError(500, trendWindowError.message);
    }

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "seo",
      source_name: "Competitor local benchmark",
      status: "succeeded",
      changes_found: sovRows.length + gapRows.length + keywordRows.length + metricRows.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google",
      units: termCount,
      detail: `${termCount} keywords for share of voice${capped ? " (monthly budget reached)" : ""}`,
    });
    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google_maps",
      units: mapsCalls,
      detail: `${competitors.length} competitor maps listings`,
    });

    return json({
      keywords: termCount,
      competitors: competitors.length,
      ourShare,
      ourTop10: ourTop10.count,
      rows: sovRows.length + gapRows.length + keywordRows.length,
      keywordRows: keywordRows.length,
      /** Their search visibility written onto each competitor row, for the caller. */
      seoScores: Object.fromEntries(seoScoreById),
      /** True when the monthly budget, not the tracked list, cut the run short. */
      capped,
    });
  } catch (error) {
    return failure(error);
  }
});

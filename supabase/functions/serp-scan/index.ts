import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { affordableCount, budgetMessage, readBudget } from "../_shared/budget.ts";
import {
  DEFAULT_KEYWORDS,
  MAX_KEYWORDS,
  clampInt,
  resolveKeywords,
} from "../_shared/keywords.ts";
import {
  buildProfileChecks,
  citationOf,
  citationWeight,
  fetchAiOverview,
  findOrganicResult,
  hostnameOf,
  localResultsOf,
  matchLocalPlace,
  organicResultsOf,
  serpApi,
  snippetTypeOf,
} from "../_shared/serpapi.ts";
import {
  standingsByKeyword,
  summariseRankings,
  type RankingRow,
} from "../_shared/seo.ts";

/**
 * Google search & local scan (SerpApi).
 *
 * For the tenant's tracked keywords it records, per device:
 *   - our organic position and whether our result carries a rich snippet;
 *   - the local map 3-pack and whether we are in it;
 * and once per run it refreshes our Google Business Profile health.
 *
 * It also writes the workspace's **search visibility** back onto the business row
 * — `seo_score`, `top10_count`, `avg_position` (each with its `previous_*`
 * counterpart) and `rankings_checked_at` — derived from the standings this scan
 * holds. The My Business health card reads those columns, so without this pass the
 * card would show the figures onboarding wrote rather than anything a scan found.
 * The derivation lives in `_shared/seo.ts`.
 *
 * ## GEO — the AI answer, not the link list
 *
 * The same Google response that carries the organic results also carries an
 * `ai_overview` when Google generated one, and that block **is** the AI answer — the
 * prose and the sources it cited. The body costs a second SerpApi request
 * (`_shared/serpapi.ts` `fetchAiOverview`), paid for only on terms that actually
 * have an overview.
 *
 * From it we record whether we were cited (named in the prose, or listed as a
 * source) per term, `my_metrics.kind = 'geo_visibility'` as one point per day, and
 * `geo_score` on the business row. The My Business GEO tile and the prompts table
 * read those, which is what makes "AI visibility" a measurement rather than a
 * blurb.
 *
 * `geo_score` is **coverage across every term the run assessed**, weighted by how
 * prominently each answer cited us (`_shared/serpapi.ts` `citationWeight`): a term
 * whose answer cites us scores by its prominence, a term Google answers with no AI
 * overview scores nothing, and a term whose answer the monthly budget stopped us
 * reading scores nothing too — we scanned the term, so excluding it would let a
 * couple of reads produce a perfect score. That replaced `cited ÷ overviews read`,
 * which scored 100 whenever the one overview we happened to read named us and sat
 * frozen whenever a run read none. Google AI Overview is one assistant, not all of
 * them: the engine column says which one answered, and no other assistant is claimed.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
type Device = "desktop" | "mobile";

interface Body {
  businessId?: string;
  keywords?: string[];
  devices?: Device[];
  location?: string;
  limit?: number;
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
      // The score columns come along so each one's previous value — which is what
      // the card shows movement against — can be carried over on the write below.
      .select(
        "id, brand_name, primary_domain, country, seo_score, top10_count, avg_position, geo_score",
      )
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const brandName = String(business.brand_name ?? "");
    const domain = hostnameOf(String(business.primary_domain ?? ""));
    const location = String(body.location ?? business.country ?? "").trim();

    const devices: Device[] = (
      body.devices?.length ? body.devices : ["desktop", "mobile"]
    ).filter((d): d is Device => d === "desktop" || d === "mobile");

    const allKeywords = await resolveKeywords(db, businessId, body.keywords);
    if (!allKeywords.length) {
      throw new HttpError(
        409,
        "No tracked keywords yet. Find some keywords on My Business, then run the scan again.",
      );
    }
    const requested = Math.min(clampInt(body.limit, 1, MAX_KEYWORDS, DEFAULT_KEYWORDS), allKeywords.length);

    // Spend is planned before it happens: one search per keyword × device, plus
    // the Business profile lookup below. A run trims itself to whatever the
    // workspace has left this month rather than overshooting the budget.
    const budget = await readBudget(db, businessId, "serpapi");
    const unitsPerKeyword = devices.length;
    const affordable = affordableCount(budget.remaining, unitsPerKeyword, 1);
    if (affordable < 1) throw new HttpError(429, budgetMessage("serpapi", budget, unitsPerKeyword + 1));

    const keywords = allKeywords.slice(0, Math.min(requested, affordable));
    const capped = keywords.length < requested;

    // The AI-overview bodies are a second request *each*, and how many terms have an
    // overview is not knowable before the searches run. So the allowance is computed
    // from what is left once this run's searches and the Maps lookup are paid for,
    // and the loop stops reading bodies when it is used up — an overview is the
    // first thing dropped, because the rankings are the reason the scan exists.
    const overviewAllowance = Math.max(
      0,
      Math.floor(budget.remaining - 1 - keywords.length * devices.length),
    );
    /** Bodies actually read back. */
    let overviewCalls = 0;
    /** Body requests made, read or not: these are what the provider bills. */
    let overviewAttempts = 0;
    let citedCount = 0;
    /**
     * Terms Google served no AI answer for. Assessed — the term was checked and
     * nothing cited us because there was nothing to cite us in — so it belongs in
     * the score's denominator. It was left out when that denominator was "overviews
     * read", which is what made one cited answer out of one read score 100.
     */
    let noOverviewCount = 0;
    /**
     * Terms whose AI answer existed but whose body we could not read — the monthly
     * budget stopped the read, or Google would not replay the token. The term *was*
     * scanned, so it belongs in the score's denominator as an unread miss: leaving
     * it out is what let two reads out of five tracked terms report 100.
     */
    let overviewUnread = 0;
    /** Summed prominence of our citations, weighted per term by `citationWeight`. */
    let geoWeight = 0;
    const overviewCapped = { at: false };

    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    // Snapshot the previous scan so the app can alert on a drop out of the pack
    // or a lost rich snippet (the upsert below overwrites the current row).
    const { data: priorRankings } = await db
      .from("serp_rankings")
      .select("keyword, device, location, position, is_rich_result, snippet_type")
      .eq("business_id", businessId);
    const priorRankingByKey = new Map<string, Record<string, unknown>>();
    for (const row of priorRankings ?? []) {
      priorRankingByKey.set(
        `${row.keyword}|${row.device}|${row.location}`,
        row as Record<string, unknown>,
      );
    }

    const { data: priorPacks } = await db
      .from("local_pack_rankings")
      .select("keyword, location, in_pack, pack_position")
      .eq("business_id", businessId);
    const priorPackByKey = new Map<string, Record<string, unknown>>();
    for (const row of priorPacks ?? []) {
      priorPackByKey.set(`${row.keyword}|${row.location}`, row as Record<string, unknown>);
    }

    const geoRows: Record<string, unknown>[] = [];
    /** The engine that answered, named on the row so no other assistant is implied. */
    const AI_OVERVIEW_ENGINE = "Google AI Overview";
    /**
     * A term Google answered without an AI overview. Named distinctly so the
     * answers table shows the term was checked rather than implying an AI answer
     * existed and simply left us out of it.
     */
    const NO_OVERVIEW_ENGINE = "Google AI Overview (no answer)";

    /* ------------------------------------------- Google Business Profile health */
    let healthRow: Record<string, unknown> | null = null;
    const mapsResponse = await serpApi({
      engine: "google_maps",
      type: "search",
      q: `${brandName} ${location}`.trim(),
      hl: "en",
    });
    const candidates = localResultsOf(mapsResponse);
    const place =
      mapsResponse.place_results ??
      candidates.find((entry) => matchLocalPlace(entry, domain, brandName)) ??
      candidates[0];

    if (place) {
      const checks = buildProfileChecks(place);
      const passed = checks.filter((check) => check.ok).length;
      healthRow = {
        business_id: businessId,
        place_id: String(place.place_id ?? place.data_id ?? hostnameOf(String(place.website ?? ""))),
        label: String(place.title ?? brandName),
        score: Math.round((passed / checks.length) * 100),
        checks,
        reviews_count: Number(place.reviews ?? 0),
        average_rating: Number(place.rating ?? 0),
        address: String(place.address ?? ""),
        category: String(place.type ?? ""),
        website: String(place.website ?? ""),
        checked_at: checkedAt,
      };
      if (!String(healthRow.place_id)) healthRow = null;
    }
    const ourPlaceId = healthRow ? String(healthRow.place_id) : "";

    /* --------------------------------------------- organic rank + local 3-pack */
    const rankingRows: Record<string, unknown>[] = [];
    const packRows: Record<string, unknown>[] = [];
    /**
     * `local_pack_rankings` holds one row per keyword × location, but the loop below
     * visits every keyword once per device — and Google returns a pack for more than
     * one of them. Pushing both would put two rows with the same conflict key in a
     * single upsert, which Postgres refuses outright ("ON CONFLICT DO UPDATE command
     * cannot affect row a second time"), failing the whole run. The first device that
     * answers for a term wins, which with the default order is desktop.
     */
    const packKeys = new Set<string>();

    for (const keyword of keywords) {
      for (const device of devices) {
        const response = await serpApi({
          engine: "google",
          q: keyword,
          location: location || undefined,
          device,
          num: 100,
          hl: "en",
          // An AI-overview page token cannot be replayed from a cached SERP: the body
          // request answers "Google hasn't returned any results for this query". The
          // desktop pass is the one that reads the overview, so it asks for a fresh
          // result. The mobile pass keeps the default, and the ranks of the two
          // devices are independent rows anyway.
          no_cache: device === "desktop" ? true : undefined,
        });

        const match = findOrganicResult(organicResultsOf(response), domain, brandName);
        const prior = priorRankingByKey.get(`${keyword}|${device}|${location}`);
        rankingRows.push({
          business_id: businessId,
          keyword,
          device,
          location,
          position: match?.position ?? null,
          url: match ? String(match.link ?? "") : "",
          title: match ? String(match.title ?? "") : "",
          snippet_type: snippetTypeOf(match),
          is_rich_result: Boolean(match?.rich_snippet || match?.rich_snippet_table),
          previous_position: prior ? prior.position ?? null : null,
          previous_is_rich_result: prior ? prior.is_rich_result ?? null : null,
          previous_snippet_type: prior ? String(prior.snippet_type ?? "") : "",
          checked_at: checkedAt,
        });

        // The AI answer for this term, read once — on the desktop pass — because an
        // overview belongs to the query rather than to the device we asked from.
        if (device === "desktop") {
          if (response.ai_overview?.page_token) {
            if (overviewAttempts >= overviewAllowance) {
              overviewCapped.at = true;
              overviewUnread += 1;
            } else {
              overviewAttempts += 1;
              const overview = await fetchAiOverview(String(response.ai_overview.page_token));
              // A token Google will not replay is a query we could not read, not a query
              // that failed to cite us. It is counted as an unread miss so it stays in
              // the score's denominator: reading nothing must not read as a pass.
              if (overview) {
                overviewCalls += 1;
                const citation = citationOf(overview, domain, brandName);
                if (citation.cited) citedCount += 1;
                geoWeight += citationWeight(citation);
                // `sources` rides in `volume`: it is the count of places the answer drew
                // on, which is what tells a user how hard-won a citation is.
                geoRows.push({
                  business_id: businessId,
                  keyword,
                  kind: "geo",
                  engine: AI_OVERVIEW_ENGINE,
                  volume: citation.sources,
                  // 0 means "not cited", so any positive value reads as cited and keeps
                  // which source was ours when the answer listed one.
                  position: citation.cited ? citation.position || 1 : 0,
                  change: 0,
                  week_of: checkedAt.slice(0, 10),
                });
              } else {
                overviewUnread += 1;
              }
            }
          } else {
            // Google answered this term without an AI overview at all: the answer
            // surfaces nobody, so we are not visible on it. It is an assessed miss
            // — recorded as a row as well as counted, so the answers table lists
            // every term the run checked instead of only the ones that cited us.
            noOverviewCount += 1;
            geoRows.push({
              business_id: businessId,
              keyword,
              kind: "geo",
              engine: NO_OVERVIEW_ENGINE,
              volume: 0,
              position: 0,
              change: 0,
              week_of: checkedAt.slice(0, 10),
            });
          }
        }

        const pack = localResultsOf(response).slice(0, 3).map((entry, index) => ({
          position: Number(entry.position ?? index + 1),
          name: String(entry.title ?? ""),
          place_id: String(entry.place_id ?? entry.data_id ?? ""),
          rating: Number(entry.rating ?? 0),
          reviews: Number(entry.reviews ?? 0),
        }));

        if (pack.length && !packKeys.has(`${keyword}|${location}`)) {
          packKeys.add(`${keyword}|${location}`);
          const ours =
            pack.find((entry) => ourPlaceId && entry.place_id === ourPlaceId) ??
            pack.find((entry) => matchLocalPlace({ title: entry.name }, domain, brandName));
          const priorPack = priorPackByKey.get(`${keyword}|${location}`);
          packRows.push({
            business_id: businessId,
            keyword,
            location,
            in_pack: Boolean(ours),
            pack_position: ours?.position ?? null,
            place_id: ourPlaceId,
            pack,
            previous_in_pack: priorPack ? priorPack.in_pack ?? null : null,
            previous_pack_position: priorPack ? priorPack.pack_position ?? null : null,
            checked_at: checkedAt,
          });
        }
      }
    }

    /* ------------------------------------------------------------------ persist */
    if (rankingRows.length) {
      const { error } = await db
        .from("serp_rankings")
        .upsert(rankingRows, { onConflict: "business_id,keyword,device,location" });
      if (error) throw new HttpError(500, error.message);
    }

    if (packRows.length) {
      const { error } = await db
        .from("local_pack_rankings")
        .upsert(packRows, { onConflict: "business_id,keyword,location" });
      if (error) throw new HttpError(500, error.message);
    }

    if (healthRow) {
      const { error } = await db
        .from("local_profile_health")
        .upsert(healthRow, { onConflict: "business_id,place_id" });
      if (error) throw new HttpError(500, error.message);

      // Exactly one profile is *our* profile. The Maps query can answer with a
      // different listing of the same name from run to run, and keying the upsert by
      // place id then leaves a row per listing — so the card showed whichever one the
      // loader happened to pick, and "in the map 3-pack" was decided against a
      // listing that changed under it. This run's match is the current answer, so the
      // others are removed rather than left to compete with it.
      const { error: staleError } = await db
        .from("local_profile_health")
        .delete()
        .eq("business_id", businessId)
        .neq("place_id", ourPlaceId);
      if (staleError) throw new HttpError(500, staleError.message);
    }

    /* ------------------------------------------------------------ GEO visibility */
    // `my_keywords` has no unique key to upsert on, so this is insert-then-prune: the
    // rows written by this run carry a `created_at` at or after the moment it started,
    // so pruning below that timestamp removes only the rows it is replacing — and
    // scoping by `kind` keeps a re-scan from touching the tracked SEO terms. Clearing
    // first instead would leave the panel empty if the insert then failed.
    if (geoRows.length) {
      const { error } = await db.from("my_keywords").insert(geoRows);
      if (error) throw new HttpError(500, error.message);

      const { error: pruneError } = await db
        .from("my_keywords")
        .delete()
        .eq("business_id", businessId)
        .eq("kind", "geo")
        .lt("created_at", startedAt);
      if (pruneError) throw new HttpError(500, pruneError.message);
    }

    // The score is **coverage across every term the run assessed**: a term whose AI
    // answer cited us counts for as prominently as it was cited, a term Google
    // answered without an AI overview counts for nothing, and a term whose answer
    // existed but the monthly budget stopped us reading counts for nothing too —
    // the term was scanned, so dropping it from the denominator is what let a
    // handful of reads report a perfect score. Coverage over the scanned set is
    // what makes the figure stable; the old `cited ÷ overviews read` swung from 0
    // to 100 on whether a single overview happened to mention us.
    const geoChecked = overviewCalls + noOverviewCount + overviewUnread;
    const geoScore = geoChecked ? Math.round((geoWeight / geoChecked) * 100) : 0;

    // One point per day, replaced rather than stacked: re-running the scan is the
    // normal way to fix a bad reading, and a second point for the same day would
    // draw a spike that never happened.
    if (geoChecked) {
      const day = checkedAt.slice(0, 10);
      const { error } = await db.from("my_metrics").insert({
        business_id: businessId,
        kind: "geo_visibility",
        label: day,
        value: geoScore,
        sort_order: Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000),
      });
      if (error) throw new HttpError(500, error.message);

      const { error: metricPruneError } = await db
        .from("my_metrics")
        .delete()
        .eq("business_id", businessId)
        .eq("kind", "geo_visibility")
        .eq("label", day)
        .lt("created_at", startedAt);
      if (metricPruneError) throw new HttpError(500, metricPruneError.message);
    }

    /* ------------------------------------------------- search visibility scores */
    // Read back **every** desktop standing we hold, not just this run's: a run
    // trimmed by the monthly budget covers fewer keywords, and a score computed
    // from that slice would fall simply because less budget was left. Desktop is
    // the set the Search tab renders, so the headline and the table agree.
    const { data: standingRows } = await db
      .from("serp_rankings")
      .select("keyword, position, is_rich_result")
      .eq("business_id", businessId)
      .eq("device", "desktop");
    const summary = summariseRankings(
      standingsByKeyword((standingRows ?? []) as RankingRow[]),
    );

    // Nothing scanned yet — leave the row alone rather than overwriting an
    // onboarding figure with a blank one.
    if (summary.terms) {
      const patch: Record<string, unknown> = {
        previous_seo_score: business.seo_score ?? null,
        seo_score: summary.seoScore,
        previous_top10_count: business.top10_count ?? null,
        top10_count: summary.top10Count,
        ranked_count: summary.rankedCount,
        previous_avg_position: business.avg_position ?? null,
        // Null, not 0, when we appear for nothing: the card shows a dash, and a
        // stored zero would read as "position zero".
        avg_position: summary.avgPosition || null,
        rankings_checked_at: checkedAt,
      };

      // Written whenever the pass assessed a term, not only when it read an
      // overview. A term Google answers without an AI overview is a term where the
      // answer surfaces nobody, so leaving the stored score untouched there froze the
      // tile at whatever the last overview-bearing run happened to say.
      if (geoChecked) {
        patch.previous_geo_score = business.geo_score ?? null;
        patch.geo_score = geoScore;
      }

      const { error } = await db.from("businesses").update(patch).eq("id", businessId);
      if (error) throw new HttpError(500, error.message);
    }

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "seo",
      source_name: "Google search & local scan",
      status: "succeeded",
      changes_found: rankingRows.length + packRows.length + geoRows.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google",
      units: keywords.length * devices.length,
      detail: `${keywords.length} keywords × ${devices.length} devices${capped ? " (monthly budget reached)" : ""}`,
    });
    if (healthRow) {
      await recordUsage(db, {
        businessId,
        provider: "serpapi",
        endpoint: "google_maps",
        units: 1,
        detail: "Business profile health",
      });
    }
    if (overviewAttempts) {
      await recordUsage(db, {
        businessId,
        provider: "serpapi",
        endpoint: "google_ai_overview",
        units: overviewAttempts,
        detail: `${overviewAttempts} AI overview bodies requested · ${overviewCalls} read · ${citedCount} cited us`,
      });
    }

    return json({
      keywords: keywords.length,
      rankings: rankingRows.length,
      packKeywords: packRows.length,
      placeId: ourPlaceId,
      /** GEO: the AI-overview pass, and what it found. */
      geo: {
        overviewsRead: overviewCalls,
        overviewsRequested: overviewAttempts,
        cited: citedCount,
        /** Terms assessed for an AI answer — the score's denominator. */
        checked: geoChecked,
        score: geoChecked ? geoScore : null,
        /** True when the monthly budget stopped the overview reads early. */
        capped: overviewCapped.at,
        /** Terms whose AI answer we could not read, counted as unread misses. */
        unread: overviewUnread,
      },
      /** The search visibility written onto the business row, for the caller. */
      search: {
        seoScore: summary.seoScore,
        top10Count: summary.top10Count,
        rankedCount: summary.rankedCount,
        avgPosition: summary.avgPosition,
        terms: summary.terms,
      },
      /** True when the monthly budget, not the tracked list, cut the run short. */
      capped,
    });
  } catch (error) {
    return failure(error);
  }
});

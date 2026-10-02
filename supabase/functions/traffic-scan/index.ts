import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv, hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import { clampInt } from "../_shared/keywords.ts";
import { fetchDatasetItems, isTerminal, startRun, waitForRun } from "../_shared/apify.ts";
import {
  byDomain,
  trafficActorId,
  trafficDomain,
  trafficMaxChargeUsd,
  trafficMaxDomains,
  writeSeries,
  type DomainTraffic,
} from "../_shared/traffic.ts";

/**
 * Website traffic scan (Apify → SimilarWeb).
 *
 * This is the producer for the traffic panels. Before it existed, every traffic
 * figure in the app was dead: `businesses.monthly_visits` / `visits_change` were
 * never written, `my_metrics` had no `traffic` or `channel` rows, and
 * `competitor_metrics` had no `traffic` or `traffic_source` rows. My Business
 * showed *Website traffic* as 0 with an empty chart, and Competition's
 * *Their monthly traffic* tile and Overview chart had nothing to draw — not
 * because a scan was broken, but because nothing had ever measured it.
 *
 * One run prices our domain and every rival's together, because SimilarWeb
 * charges per domain and the panels are all read side by side.
 *
 * ## Estimates, and what that means for the copy
 *
 * SimilarWeb's figures are modelled, not counted, so they are stored and shown as
 * estimates — a third party cannot know another company's analytics. The figures
 * that *are* exact (whether a domain was found at all, and which channels it
 * attributes traffic to) are kept exactly.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
}

interface BusinessRow {
  id: string;
  primary_domain: string | null;
}

interface CompetitorRow {
  id: string;
  name: string;
  website: string;
}

/** One domain to price, and which row its result belongs to. */
interface Target {
  domain: string;
  /** `null` for our own domain. */
  competitorId: string | null;
  name: string;
}

/** The smallest spend this scan will bother starting for. */
const MIN_CHARGE_USD = 0.01;
/**
 * How long we hold the request open for the run. The provider's own runs finish
 * in seconds to a minute for a handful of domains; the ceiling is here so a stuck
 * run cannot pin the function open. A run we stop waiting for is reported as
 * still running rather than silently dropped.
 */
const WAIT_BUDGET_MS = 100_000;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // In the handler scope (not the try) so the helper below, which runs only after
  // the caller is authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let businessId = "";

  try {
    if (!hasEnv("APIFY_TOKEN")) {
      throw new HttpError(409, "Apify is not configured on the server. Add APIFY_TOKEN.");
    }
    const actorId = trafficActorId();
    if (!actorId) {
      throw new HttpError(
        409,
        "Website traffic is not configured on the server. Add APIFY_TRAFFIC_ACTOR_ID.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    db = adminClient();
    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    /* ------------------------------------------------------------ targets */

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, primary_domain")
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");
    const businessRow = business as BusinessRow;

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name, website")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);
    const competitors = (competitorRows ?? []) as CompetitorRow[];

    const ourDomain = trafficDomain(String(businessRow.primary_domain ?? ""));

    // Keyed by domain, so two competitors that share one website (or a competitor
    // whose domain is our own) are priced once rather than twice.
    const targets = new Map<string, Target>();
    if (ourDomain) targets.set(ourDomain, { domain: ourDomain, competitorId: null, name: "You" });
    const noWebsite: string[] = [];
    for (const competitor of competitors) {
      const domain = trafficDomain(competitor.website);
      if (!domain) {
        noWebsite.push(competitor.name);
        continue;
      }
      if (!targets.has(domain)) {
        targets.set(domain, { domain, competitorId: competitor.id, name: competitor.name });
      }
    }

    if (!targets.size) {
      throw new HttpError(
        409,
        "Nothing to measure yet. Add your website on My Business and at least one competitor website, then run the scan again.",
      );
    }

    const maxDomains = trafficMaxDomains();
    const selected = [...targets.values()].slice(0, maxDomains);
    const domains = selected.map((target) => target.domain);

    /* ------------------------------------------------------------- budget */

    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < MIN_CHARGE_USD) {
      throw new HttpError(429, spendMessage(spend, MIN_CHARGE_USD));
    }
    // The workspace's remaining monthly allowance, not just the per-run ceiling,
    // bounds this run — a scan cannot spend money the tenant no longer has.
    const maxChargeUsd = Number(Math.min(trafficMaxChargeUsd(), spend.remainingUsd).toFixed(4));

    /* ------------------------------------------------------- start and wait */

    const run = await startRun(actorId, { domains }, {
      maxItems: domains.length,
      maxTotalChargeUsd: maxChargeUsd,
      timeoutSecs: clampInt(getEnv("APIFY_TRAFFIC_RUN_TIMEOUT_SECS"), 30, 3600, 300),
    });

    const deadline = Date.now() + WAIT_BUDGET_MS;
    let current = run;
    while (!isTerminal(current.status) && Date.now() < deadline) {
      const secondsLeft = Math.floor((deadline - Date.now()) / 1000);
      if (secondsLeft <= 0) break;
      current = await waitForRun(current.id, Math.min(60, secondsLeft));
    }

    if (!isTerminal(current.status)) {
      return json({
        status: current.status,
        running: true,
        domains: domains.length,
        costUsd: 0,
        message:
          "The traffic read is still running. Run the scan again in a minute to collect it.",
      });
    }

    if (current.status !== "SUCCEEDED") {
      const detail = current.statusMessage ?? current.status;
      // A run that failed still costs something, so its spend is recorded before
      // we throw — otherwise the monthly figure understates what was used.
      await recordUsage(db, {
        businessId,
        provider: "apify",
        endpoint: `actors/${actorId}`,
        units: 0,
        costUsd: current.usageTotalUsd,
        status: "error",
        detail: detail.slice(0, 300),
      });
      await writeRun("failed", 0, startedAt, detail);
      throw new HttpError(502, `The traffic provider did not finish the read: ${detail}`);
    }

    /* --------------------------------------------------- normalise and write */

    const items = await fetchDatasetItems(current.defaultDatasetId, domains.length);
    const found = byDomain(items);

    const ours = ourDomain ? found.get(ourDomain) ?? null : null;
    let written = 0;

    if (ours) {
      const { error } = await db
        .from("businesses")
        .update({ monthly_visits: Math.round(ours.visits), visits_change: ours.visitsChange })
        .eq("id", businessId);
      if (error) throw new HttpError(500, error.message);

      // The monthly series accumulates: restated months are rewritten and the
      // months the provider no longer reports are kept, so the chart grows a bar
      // a month instead of resetting to whatever this run returned.
      await writeSeries(db, "my_metrics", businessId, null, "traffic", monthRows(ours));
      await replaceSeries("my_metrics", businessId, null, "channel", channelRows(ours));
      written += 1;
    }

    const rivals: string[] = [];
    for (const target of selected) {
      if (!target.competitorId) continue;
      const traffic = found.get(target.domain);
      if (!traffic) continue;

      const { error } = await db
        .from("competitors")
        .update({ monthly_visits: Math.round(traffic.visits), visits_change: traffic.visitsChange })
        .eq("id", target.competitorId)
        .eq("business_id", businessId);
      if (error) throw new HttpError(500, error.message);

      await writeSeries(db, "competitor_metrics", businessId, target.competitorId, "traffic", monthRows(traffic));
      await replaceSeries(
        "competitor_metrics",
        businessId,
        target.competitorId,
        "traffic_source",
        channelRows(traffic),
      );
      rivals.push(target.name);
      written += 1;
    }

    // A domain SimilarWeb has no data for is a normal outcome, not a failure; it
    // is reported so a small or brand-new site does not read as a broken scan.
    const unavailable = selected
      .filter((target) => !found.has(target.domain))
      .map((target) => target.name);

    await recordUsage(db, {
      businessId,
      provider: "apify",
      endpoint: `actors/${actorId}`,
      units: found.size,
      costUsd: current.usageTotalUsd,
      detail: `${domains.length} domains, ${found.size} with data`,
    });

    await writeRun(written ? "succeeded" : "failed", written, startedAt, "");

    if (!written) {
      throw new HttpError(
        502,
        `The traffic provider returned no figures for ${domains.length === 1 ? domains[0] : "any of the requested domains"}.`,
      );
    }

    return json({
      status: current.status,
      running: false,
      /** True when `APIFY_TRAFFIC_MAX_DOMAINS` cut the list short. */
      capped: targets.size > selected.length,
      domains: domains.length,
      measured: written,
      ours: ours ? { visits: ours.visits, visitsChange: ours.visitsChange } : null,
      rivals,
      unavailable,
      noWebsite,
      spendLimited: maxChargeUsd < trafficMaxChargeUsd(),
      costUsd: current.usageTotalUsd,
      checkedAt,
      message: ours
        ? `${Math.round(ours.visits).toLocaleString()} estimated visits a month for your site, plus ${rivals.length} competitor${rivals.length === 1 ? "" : "s"}.`
        : `Measured ${rivals.length} competitor site${rivals.length === 1 ? "" : "s"}. Your own domain had no figure to read.`,
    });
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /** One month per visit figure, oldest first. */
  function monthRows(traffic: DomainTraffic) {
    return traffic.series.map((point) => ({
      label: point.label,
      value: point.value,
      sortOrder: point.sortOrder,
    }));
  }

  /** One channel per share, largest first, so `sort_order` is the display order. */
  function channelRows(traffic: DomainTraffic) {
    return traffic.channels.map((channel, index) => ({
      label: channel.label,
      value: channel.share,
      sortOrder: index,
    }));
  }

  /**
   * Replaces one metric kind's rows for a business (and, for a rival, for that
   * competitor). Used for the **mixes** — channels, traffic sources — where the
   * provider restates the whole set of categories every run: a category that has
   * disappeared is no longer true and must not linger.
   *
   * A plain delete-then-insert is used because these tables have no unique key to
   * upsert against. Only the one `kind` is touched, so the SEO, GEO and review
   * series that other scans write are never at risk. **Time series** are not
   * written this way — see `writeSeries`, which keeps the months this run's
   * payload does not mention.
   */
  async function replaceSeries(
    table: "my_metrics" | "competitor_metrics",
    business: string,
    competitorId: string | null,
    kind: string,
    rows: { label: string; value: number; sortOrder: number }[],
  ): Promise<void> {
    if (!rows.length) return;

    let removal = db.from(table).delete().eq("business_id", business).eq("kind", kind);
    if (competitorId) removal = removal.eq("competitor_id", competitorId);
    const { error: deleteError } = await removal;
    if (deleteError) throw new HttpError(500, deleteError.message);

    const payload = rows.map((row) => ({
      business_id: business,
      ...(competitorId ? { competitor_id: competitorId } : {}),
      kind,
      label: row.label,
      value: row.value,
      sort_order: row.sortOrder,
    }));
    const { error } = await db.from(table).insert(payload);
    if (error) throw new HttpError(500, error.message);
  }

  /** Records the attempt in the history the pages show. Best effort. */
  async function writeRun(
    status: "succeeded" | "failed",
    changes: number,
    started: string,
    error: string,
  ): Promise<void> {
    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "traffic",
      source_name: "Website traffic",
      status,
      changes_found: changes,
      error: error ? error.slice(0, 500) : null,
      started_at: started,
      finished_at: new Date().toISOString(),
    });
  }
});

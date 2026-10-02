import { getEnv } from "./env.ts";
import { HttpError } from "./errors.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Website traffic, read from SimilarWeb through Apify.
 *
 * This is the producer behind the traffic panels on My Business and Competition:
 * monthly visits and the channel mix, for our own domain and for every rival's.
 * Nothing wrote those tables before, so the panels could only ever be empty — the
 * pages showed a chart with no series and a "Monthly visits" tile reading 0 while
 * the competitor's own site plainly had visitors.
 *
 * ## What it measures, and what it does not
 *
 * SimilarWeb publishes **estimates**, and they are modelled rather than counted —
 * a third party's traffic figure is always an estimate, and the panels say
 * "estimated" for that reason. It reports a monthly visit series, the share each
 * channel contributed, and a rank. It does **not** report which search surfaces
 * sent the visits, so the "Search surfaces" list has no source here and is left
 * empty rather than filled with a number nothing measured.
 *
 * The field names below were read off the actor's live output
 * (`curious_coder/similarweb-scraper`, input `{ domains: [...] }`), not guessed.
 */

/** One channel's share of a domain's visits. `share` is a percentage, 0–100. */
export interface TrafficChannel {
  label: string;
  share: number;
}

/** One month of the visit series. `sortOrder` is months since the epoch, so the
 *  rows sort chronologically however they are stored. */
export interface TrafficPointRow {
  label: string;
  value: number;
  sortOrder: number;
}

/** One domain's traffic, mapped onto our own columns. */
export interface DomainTraffic {
  domain: string;
  /** Visits in the latest month SimilarWeb reports. */
  visits: number;
  /** Percent change against the previous month; 0 when there is nothing to compare. */
  visitsChange: number;
  series: TrafficPointRow[];
  channels: TrafficChannel[];
}

/**
 * The actor id, as a **bare id** rather than an `owner/name` slug.
 *
 * `startRun` puts the id straight into `/v2/actors/{id}/runs`, and an encoded slug
 * is not a valid actor reference there — the same trap `site-scan` documents for
 * its own actor. Empty means the deployment has not opted in, and the panel reports
 * the feature as off rather than spending.
 */
export function trafficActorId(): string {
  return getEnv("APIFY_TRAFFIC_ACTOR_ID") || "";
}

/** The ceiling for one traffic run, in dollars. */
export function trafficMaxChargeUsd(): number {
  const configured = Number(getEnv("APIFY_TRAFFIC_MAX_CHARGE_USD"));
  return Number.isFinite(configured) && configured > 0 ? configured : 0.25;
}

/** How many domains one run may price, so a big workspace cannot run away. */
export function trafficMaxDomains(): number {
  const configured = Number(getEnv("APIFY_TRAFFIC_MAX_DOMAINS"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(50, configured) : 12;
}

/** A domain as the actor wants it: hostname only, no scheme, no `www.`. */
export function trafficDomain(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

/** "SearchOrganic" → "Search organic", so a channel reads like a channel. */
function channelLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Months since the epoch for a `YYYY-MM-DD` label, which is what the loader sorts
 * a metric series by. An unparseable date sorts last rather than throwing.
 */
function monthOrder(label: string): number {
  const parsed = Date.parse(`${label}T00:00:00Z`);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 86_400_000);
}

/** Percent change between the last two points, or 0 when there is no comparison. */
function changeOf(series: TrafficPointRow[]): number {
  if (series.length < 2) return 0;
  const previous = series[series.length - 2].value;
  const latest = series[series.length - 1].value;
  if (!previous) return 0;
  return Number((((latest - previous) / previous) * 100).toFixed(1));
}

/** Numbers arriving as strings ("1911397") are common in scraped output. */
function numberOf(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One dataset item → one domain's traffic, or null when it is not usable.
 *
 * A domain with no visit figure at all is dropped rather than stored as zero:
 * "SimilarWeb has nothing for this site" and "this site had no visitors" are
 * different facts, and a stored zero would read as the second.
 */
export function normaliseTraffic(item: Record<string, unknown>): DomainTraffic | null {
  if (!item || typeof item !== "object") return null;
  const domain = trafficDomain(String(item.domain ?? ""));
  if (!domain) return null;

  const estimated = (item.estimatedMonthlyVisits ?? {}) as Record<string, unknown>;
  const series: TrafficPointRow[] = Object.entries(estimated)
    .map(([label, value]) => ({ label, value: numberOf(value), sortOrder: monthOrder(label) }))
    .filter((point) => point.value > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // `visits` is SimilarWeb's own headline figure for the latest month; the series'
  // last point is the same number and stands in when the field is absent.
  const visits = numberOf(item.visits) || series.at(-1)?.value || 0;
  if (!visits) return null;

  const sources = (item.trafficSources ?? {}) as Record<string, unknown>;
  const channels: TrafficChannel[] = Object.entries(sources)
    .map(([key, value]) => ({ label: channelLabel(key), share: numberOf(value) * 100 }))
    .filter((channel) => channel.label && channel.share > 0)
    .map((channel) => ({ label: channel.label, share: Number(channel.share.toFixed(2)) }))
    .sort((a, b) => b.share - a.share);

  return { domain, visits, visitsChange: changeOf(series), series, channels };
}

/** Every domain in a dataset item set, so a caller can match one back to a rival. */
export function byDomain(items: Record<string, unknown>[]): Map<string, DomainTraffic> {
  const map = new Map<string, DomainTraffic>();
  for (const item of items) {
    const traffic = normaliseTraffic(item);
    if (traffic) map.set(traffic.domain, traffic);
  }
  return map;
}

/* ------------------------------------------------- writing the time series */

/**
 * How many points one monthly series keeps. Twelve months is a full window:
 * beyond it the bars stop being told apart and the labels stop being read, so
 * the oldest month ages out instead of being drawn.
 */
export const SERIES_WINDOW = 12;

/** One point of a stored time series, as far as a rewrite needs to know it. */
export interface StoredPoint {
  label: string;
  sortOrder: number;
}

/** What one rewrite of a series should delete and insert. */
export interface SeriesRestatement {
  /** Labels whose stored rows go: the ones being restated, and the ones that aged out. */
  dropLabels: string[];
  /** The incoming points that fit inside the window, in the order they should be stored. */
  insert: { label: string; value: number; sortOrder: number }[];
}

/**
 * Decides how a series is rewritten so **history survives a restatement**.
 *
 * The provider only ever returns its most recent window (SimilarWeb hands back
 * three months), and replacing the stored rows wholesale is what left the traffic
 * charts pinned at three bars however often the scan ran: each run threw away the
 * months before it. The rules here keep both properties the desk needs —
 *
 *   - a label the provider *does* return is restated (old rows for it are dropped
 *     and the new value stored), so a re-read month cannot leave two values behind;
 *   - labels it does not return are kept until they fall outside `window`, so past
 *     months accumulate into a chart that grows instead of resetting; and
 *   - only `window` points are stored at all, which is what keeps the chart
 *     readable after a year of scans.
 *
 * Nothing here invents a value: every stored point was read on the day it claims.
 */
export function seriesRestatement(
  stored: StoredPoint[],
  incoming: { label: string; value: number; sortOrder: number }[],
  window = SERIES_WINDOW,
): SeriesRestatement {
  const incomingLabels = new Set(incoming.map((point) => point.label));
  // Survivors are the months the provider no longer reports — the history.
  const survivors = stored.filter((point) => !incomingLabels.has(point.label));

  const kept = [...survivors, ...incoming]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(-Math.max(1, window));
  const keptLabels = new Set(kept.map((point) => point.label));

  return {
    // A stored row goes when it is being restated, or when it fell out of the window.
    dropLabels: stored
      .filter((point) => incomingLabels.has(point.label) || !keptLabels.has(point.label))
      .map((point) => point.label),
    insert: incoming.filter((point) => keptLabels.has(point.label)),
  };
}

/**
 * Writes one time-series kind for a business (and, for a rival, for that
 * competitor): read what is stored, restate the labels the provider returned,
 * keep the history that fits the window, drop the rest.
 *
 * A plain read-delete-insert rather than an upsert, because these tables have no
 * unique key to upsert against. Only the one `kind` is touched, so the channel,
 * surface and review series other scans write are never at risk.
 */
export async function writeSeries(
  db: SupabaseClient,
  table: "my_metrics" | "competitor_metrics",
  business: string,
  competitorId: string | null,
  kind: string,
  rows: { label: string; value: number; sortOrder: number }[],
  window = SERIES_WINDOW,
): Promise<void> {
  if (!rows.length) return;

  let storedQuery = db
    .from(table)
    .select("label, sort_order")
    .eq("business_id", business)
    .eq("kind", kind);
  if (competitorId) storedQuery = storedQuery.eq("competitor_id", competitorId);
  const { data: storedRows, error: readError } = await storedQuery;
  if (readError) throw new HttpError(500, readError.message);

  const stored: StoredPoint[] = (storedRows ?? []).map((row: { label: string; sort_order: number }) => ({
    label: String(row.label),
    sortOrder: Number(row.sort_order ?? 0),
  }));
  const plan = seriesRestatement(stored, rows, window);

  if (plan.dropLabels.length) {
    let removal = db.from(table).delete().eq("business_id", business).eq("kind", kind);
    if (competitorId) removal = removal.eq("competitor_id", competitorId);
    const { error: deleteError } = await removal.in("label", plan.dropLabels);
    if (deleteError) throw new HttpError(500, deleteError.message);
  }

  if (plan.insert.length) {
    const payload = plan.insert.map((row) => ({
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
}

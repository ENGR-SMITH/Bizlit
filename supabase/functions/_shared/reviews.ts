import {
  fetchDatasetItems,
  isTerminal,
  startRun,
  waitForRun,
  type ApifyRun,
} from "./apify.ts";
import { getEnv, hasEnv, requireEnv } from "./env.ts";
import { HttpError } from "./errors.ts";
import { localResultsOf, serpApi, type SerpApiResponse } from "./serpapi.ts";

/**
 * Review reading and replying, without a dedicated review-monitoring vendor.
 *
 * Reviewflowz was replaced because it needs its own paid account; this module
 * assembles the same capability from what the workspace already pays for:
 *
 *   google        → SerpApi `google_maps_reviews` (a Maps listing's reviews)
 *   tripadvisor   → SerpApi `tripadvisor_reviews`
 *   yelp, g2,
 *   capterra,
 *   trustpilot    → an Apify actor, chosen per platform by env var
 *
 * Reads are by **public** handle or URL, so a rival's page can be watched
 * without anyone logging in — the same property the old client had.
 *
 * Replies are a deliberate gap. The only compliant way to *post* a reply is the
 * platform's own business API, and Google's (`mybusiness.googleapis.com`) only
 * accepts review ids it minted itself — a review id scraped from Maps is not
 * one of them. So a Google reply needs the profile ingested *directly* from
 * Google Business Profile (OAuth + Google's API-access allowlisting), which is
 * Phase B. Until that connection exists `sendReply` refuses with a 409 that says
 * so, rather than failing obscurely or pretending to have posted.
 */

/* ---------------------------------------------------------------- platforms */

export type ReviewPlatform =
  | "google"
  | "yelp"
  | "g2"
  | "trustpilot"
  | "capterra"
  | "tripadvisor";

/** Display names, mirroring the sample data the pages already render. */
const PLATFORM_LABELS: Record<string, string> = {
  google: "Google Reviews",
  yelp: "Yelp",
  g2: "G2",
  trustpilot: "Trustpilot",
  capterra: "Capterra",
  tripadvisor: "TripAdvisor",
  facebook: "Facebook",
};

export function platformLabelOf(platform: string): string {
  return PLATFORM_LABELS[platform.trim().toLowerCase()] ?? platform;
}

/** Known platforms, for the connect form's options. */
export const REVIEW_PLATFORMS = Object.keys(PLATFORM_LABELS) as ReviewPlatform[];

/** Reviews we ask a provider for per profile per sync. Both SerpApi review
 * engines cap a page at 20, so a larger number is clamped rather than rejected. */
export const DEFAULT_MAX_REVIEWS = 20;
const MAX_REVIEWS_PER_CALL = 20;

/**
 * The label a sync writes for its trend point: one point per **day**, so the
 * review-score chart on Social accrues a bar every time the workspace is
 * refreshed instead of one bar a month (which is what a month-short label gave a
 * workspace its first weeks: a single, lonely column).
 *
 * A same-day re-sync updates today's point rather than adding a duplicate, so the
 * series stays a measurement per day however often the sync runs.
 */
export function reviewTrendLabel(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * How many days of trend are kept per source. Two months of daily bars is a real
 * trend the chart can draw; past that the columns stop being told apart, so the
 * oldest days age out instead of being kept forever.
 */
export const REVIEW_TREND_WINDOW = 60;

/** What one page of the Google Maps reviews engine returns. */
const GOOGLE_REVIEWS_PER_PAGE = 8;
/**
 * Pages one Google review read walks at most.
 *
 * The engine returns 8 reviews a page, so filling the default 20 takes three
 * searches. The cap bounds what a single sync can spend when a listing has
 * thousands of reviews and the caller asked for more than one page.
 */
const MAX_REVIEW_PAGES = 3;

/**
 * Review reading is possible as soon as *either* reader is configured: Google and
 * TripAdvisor reviews ride on SerpApi, everything else on Apify. There is no
 * review-vendor key to add.
 */
export function reviewsConfigured(): boolean {
  return hasEnv("SERPAPI_KEY") || hasEnv("APIFY_TOKEN");
}

/** Platforms whose reviews come from SerpApi rather than an Apify actor. */
const SERPAPI_PLATFORMS = new Set(["google", "tripadvisor"]);

/** The Apify actor id configured for a platform, empty when none is set. */
function reviewActorFor(platform: string): string {
  return getEnv(`APIFY_${platform.toUpperCase()}_REVIEWS_ACTOR_ID`) || "";
}

/**
 * Every platform the deployment can actually read right now, so the UI can tell
 * a user which of their connected profiles will sync.
 */
export function readablePlatforms(): string[] {
  return REVIEW_PLATFORMS.filter((platform) =>
    SERPAPI_PLATFORMS.has(platform) ? hasEnv("SERPAPI_KEY") : reviewActorFor(platform).length > 0,
  );
}

/* --------------------------------------------------------------- normalising */

interface RawReview {
  id?: unknown;
  platform?: unknown;
  rating?: unknown;
  author?: unknown;
  language?: unknown;
  text?: unknown;
  body?: unknown;
  date?: unknown;
  created_at?: unknown;
  replied?: unknown;
  reply?: unknown;
}

/** One provider review, mapped onto our own columns. */
export interface SyncedReview {
  externalId: string;
  platform: string;
  author: string;
  rating: number;
  language: string;
  text: string;
  postedAt: string | null;
  replied: boolean;
  replyText: string;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function ratingOf(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return 0;
  return Math.min(5, Math.max(0, Math.round(parsed)));
}

/** ISO timestamp from an ISO string, a plain date, or a unix timestamp. */
function toIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const raw = firstString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Durable id for a review the provider did not give one — stable across syncs. */
function fallbackId(platform: string, review: RawReview): string {
  const fingerprint = [platform, firstString(review.author), firstString(review.text), firstString(review.date, review.created_at)].join("|");
  // A tiny non-cryptographic hash is enough: it only has to be stable.
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i += 1) {
    hash = (hash * 31 + fingerprint.charCodeAt(i)) | 0;
  }
  return `rf-${(hash >>> 0).toString(36)}`;
}

/** One raw provider review → our shape, or null when it carries no content. */
export function normaliseReview(
  raw: RawReview,
  platform: string,
): SyncedReview | null {
  const text = firstString(raw.text, raw.body);
  const externalId = firstString(raw.id) || (text ? fallbackId(platform, raw) : "");
  if (!externalId) return null;

  const replyRaw = raw.reply as Record<string, unknown> | string | undefined;
  const replyText =
    typeof replyRaw === "string" ? replyRaw.trim() : firstString((replyRaw as Record<string, unknown>)?.text, (replyRaw as Record<string, unknown>)?.body);

  return {
    externalId,
    platform: firstString(raw.platform, platform).toLowerCase(),
    author: firstString(raw.author) || "Customer",
    rating: ratingOf(raw.rating),
    language: firstString(raw.language),
    text,
    postedAt: toIso(raw.created_at ?? raw.date),
    replied: raw.replied === true || Boolean(replyText),
    replyText,
  };
}

/** All usable reviews from a response, de-duplicated by external id. */
export function normaliseReviews(response: { reviews?: RawReview[] }, platform: string): SyncedReview[] {
  const byId = new Map<string, SyncedReview>();
  for (const raw of response.reviews ?? []) {
    const review = normaliseReview(raw, platform);
    if (review) byId.set(review.externalId, review);
  }
  return [...byId.values()];
}

/* --------------------------------------------------------- provider mapping */

/**
 * SerpApi's review engines each have their own field names, so each engine gets
 * a small mapper onto the shape `normaliseReview` reads. Aliases are tried
 * rather than assumed, because an engine's fields have moved before.
 */
export function mapGoogleReview(raw: Record<string, unknown>): RawReview {
  const user = raw.user as Record<string, unknown> | undefined;
  const extracted = raw.extracted_snippet as Record<string, unknown> | undefined;
  const response = raw.response as Record<string, unknown> | undefined;
  const responseExtracted = response?.extracted_snippet as Record<string, unknown> | undefined;

  return {
    id: firstString(raw.review_id, raw.id),
    platform: "google",
    rating: raw.rating,
    author: firstString(user?.name, raw.author_name),
    language: firstString(raw.language),
    text: firstString(extracted?.original, raw.snippet, raw.text),
    date: firstString(raw.iso_date, raw.date),
    replied: Boolean(response),
    reply: response
      ? { text: firstString(responseExtracted?.original, response.snippet) }
      : undefined,
  };
}

export function mapTripadvisorReview(raw: Record<string, unknown>): RawReview {
  const author = raw.author as Record<string, unknown> | undefined;
  const title = firstString(raw.title);
  const snippet = firstString(raw.snippet, raw.text);

  return {
    id: firstString(raw.review_id, raw.id),
    platform: "tripadvisor",
    rating: raw.rating,
    author: firstString(author?.display_name, author?.username, raw.author_name),
    language: firstString(raw.language, raw.original_language),
    // The title is how a Tripadvisor review reads; keep it with the body so the
    // reply composer has the whole thing to work from.
    text: [title, snippet].filter(Boolean).join("\n\n"),
    date: firstString(raw.date, raw.iso_date),
  };
}

/** A person's name from either a plain string field or a nested person object. */
function nameOf(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const person = value as Record<string, unknown>;
      // `fullName` is Capterra's spelling; the others cover the remaining actors.
      const name = firstString(
        person.name,
        person.fullName,
        person.full_name,
        person.displayName,
        person.display_name,
        person.username,
        person.userName,
      );
      if (name) return name;
    }
  }
  return "";
}

/** Reply text from either a plain string or an object that carries it. */
function replyTextOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const reply = value as Record<string, unknown>;
    return firstString(reply.text, reply.body, reply.comment, reply.message);
  }
  return "";
}

/**
 * One Apify review actor item, mapped onto the shape `normaliseReview` reads.
 *
 * Every spelling below was taken from the **live output** of the actor wired up
 * for that platform, because a generic "common field names" list silently loses
 * data: the actors agree on almost nothing.
 *
 *   yelp       reviewEncid · text · rating · author (plain string) ·
 *              reviewDate · publicReply
 *   g2         reviewId · text · starRating · reviewerName · date
 *   capterra   reviewId · generalComments · overallRating · reviewer{name} ·
 *              writtenOn · vendorResponse
 *
 * Ratings in particular are spelled four different ways across the three, and
 * an unread rating produces a 0-star review rather than an error.
 */
export function mapApifyReview(raw: Record<string, unknown>, platform: string): RawReview {
  const owner = [
    raw.ownerResponse,
    raw.publicReply,
    raw.vendorResponse,
    raw.businessResponse,
    raw.response,
    raw.owner_response,
  ]
    .map(replyTextOf)
    .find(Boolean);

  // Yelp and G2 carry the body in `text`; Capterra in `generalComments` and, for
  // older reviews, only in the split pros/cons fields.
  const body = firstString(
    raw.text,
    raw.reviewText,
    raw.generalComments,
    raw.body,
    raw.content,
    raw.comments,
  );
  const fromProsAndCons = [firstString(raw.prosText), firstString(raw.consText)]
    .filter(Boolean)
    .join("\n\n");

  return {
    id: firstString(raw.reviewId, raw.reviewEncid, raw.id, raw.review_id, raw.uuid),
    platform,
    rating:
      raw.rating ??
      raw.overallRating ??
      raw.starRating ??
      raw.ratingValue ??
      raw.stars ??
      raw.score,
    author: nameOf(raw.author, raw.reviewer, raw.reviewerName, raw.authorName, raw.userName, raw.user),
    language: firstString(raw.language, raw.lang),
    text: body || fromProsAndCons,
    date: firstString(raw.date, raw.reviewDate, raw.writtenOn, raw.publishedDate, raw.createdAt, raw.postedAt),
    replied: Boolean(owner),
    reply: owner ? { text: owner } : undefined,
  };
}

/* -------------------------------------------------------------- place ids */

const DATA_ID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;
const GOOGLE_PLACE_ID_RE = /^ChI[\w-]+$/;
const NUMERIC_ID_RE = /^\d+$/;

/**
 * What a Google Maps lookup should be asked for, given the handle the user typed.
 *
 * A handle is very often the business's own website — `https://www.patagonia.com/home/`
 * — and Maps will not resolve a path: "www.patagonia.com/home" comes back with no
 * results, while "patagonia.com" resolves the listing correctly. So only the host
 * is kept, the scheme and any path/query are dropped, and a leading `www.` goes too.
 * A plain name ("Joe's Coffee, Austin") or an id has no slash and is passed through.
 */
function googleMapsQuery(handle: string): string {
  const trimmed = handle.trim();
  const host = trimmed
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "");
  return host || trimmed;
}

/**
 * SerpApi's review engines are addressed by a place id, not a URL, so a handle
 * the user typed as a URL or business name is resolved to one first. A handle
 * that already *is* an id is used as-is, which saves a billed search.
 */
async function resolveGooglePlace(handle: string): Promise<{ data_id?: string; place_id?: string }> {
  const trimmed = handle.trim();
  if (DATA_ID_RE.test(trimmed)) return { data_id: trimmed };
  if (GOOGLE_PLACE_ID_RE.test(trimmed)) return { place_id: trimmed };

  // A Maps URL carries the id in its `data=` segment; pull it out when present.
  const embedded = trimmed.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  if (embedded) return { data_id: embedded[0] };

  const query = googleMapsQuery(trimmed);
  let response: SerpApiResponse;
  try {
    response = await serpApi({ engine: "google_maps", q: query || trimmed, hl: "en" });
  } catch (cause) {
    // SerpApi reports a lookup that matched nothing as an error string rather than
    // an empty result set. It is the one case worth restating: the raw message ("Google
    // hasn't returned any results for this query") does not tell the user that the
    // handle is the problem or what a working one looks like.
    if (cause instanceof Error && /hasn't returned any results/i.test(cause.message)) {
      throw new HttpError(
        409,
        `Could not find a Google Maps listing for "${trimmed}". Paste the listing's own URL, its data_id (0x…:0x…), or its place_id (ChIJ…).`,
      );
    }
    throw cause;
  }
  const place = response.place_results ?? localResultsOf(response)[0];
  if (place?.data_id) return { data_id: String(place.data_id) };
  if (place?.place_id) return { place_id: String(place.place_id) };

  throw new HttpError(
    409,
    `Could not find a Google Maps listing for "${trimmed}". Paste the listing's own URL, its data_id (0x…:0x…), or its place_id (ChIJ…).`,
  );
}

/** The Tripadvisor `place_id` behind a handle — numeric ids are already it. */
async function resolveTripadvisorPlace(handle: string): Promise<string> {
  const trimmed = handle.trim();
  if (NUMERIC_ID_RE.test(trimmed)) return trimmed;

  // Tripadvisor review URLs carry the id as `-d<id>-`.
  const embedded = trimmed.match(/-d(\d+)-/);
  if (embedded) return embedded[1];

  const query = trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const response = await serpApi({ engine: "tripadvisor", q: query || trimmed, tripadvisor_domain: "www.tripadvisor.com" });
  const candidates = [
    response.place_results,
    ...localResultsOf(response),
  ] as Record<string, unknown>[];
  for (const candidate of candidates) {
    const id = firstString(candidate?.place_id);
    if (id) return id;
  }

  throw new HttpError(
    409,
    `Could not find a Tripadvisor listing for "${trimmed}". Paste the listing's URL, or its numeric place id.`,
  );
}

/** Which of the two readers serves a platform, so its budget can be checked. */
export type ReviewReader = "serpapi" | "apify";

export function readerFor(platform: string): ReviewReader {
  return SERPAPI_PLATFORMS.has(platform.trim().toLowerCase()) ? "serpapi" : "apify";
}

/**
 * True when the handle is a name or URL rather than the id the reader wants, so
 * the caller knows the read costs one extra search to resolve it.
 */
export function needsPlaceLookup(platform: string, handle: string): boolean {
  const trimmed = handle.trim();
  switch (platform.trim().toLowerCase()) {
    case "google":
      return !(
        DATA_ID_RE.test(trimmed) ||
        GOOGLE_PLACE_ID_RE.test(trimmed) ||
        /0x[0-9a-f]+:0x[0-9a-f]+/i.test(trimmed)
      );
    case "tripadvisor":
      return !(NUMERIC_ID_RE.test(trimmed) || /-d\d+-/.test(trimmed));
    default:
      return false;
  }
}

/* ---------------------------------------------------------------- reading */

/**
 * The most SerpApi searches one Google review read can cost: the pages it walks
 * plus the one extra search a name or URL costs to resolve into a place id.
 *
 * The caller budgets with this rather than the old flat one, so a read is never
 * started on an allowance it cannot pay for.
 */
export function googleReviewSearchCost(handle: string, limit = DEFAULT_MAX_REVIEWS): number {
  const wanted = Math.min(MAX_REVIEWS_PER_CALL, Math.max(1, limit));
  const pages = Math.min(MAX_REVIEW_PAGES, Math.max(1, Math.ceil(wanted / GOOGLE_REVIEWS_PER_PAGE)));
  return pages + (needsPlaceLookup("google", handle) ? 1 : 0);
}

/**
 * Reviews for one monitored profile, newest first, with what the read cost in
 * provider searches — the caller records that figure, so the usage panel shows
 * what was spent rather than what was reserved.
 */
export async function fetchReviews(
  platform: string,
  handle: string,
  limit = DEFAULT_MAX_REVIEWS,
): Promise<{ reviews: SyncedReview[]; searches: number }> {
  const normalisedPlatform = platform.trim().toLowerCase();
  const wanted = Math.min(MAX_REVIEWS_PER_CALL, Math.max(1, limit));

  if (normalisedPlatform === "google") {
    requireEnv("SERPAPI_KEY");
    const place = await resolveGooglePlace(handle);
    // `num` is only legal on this engine alongside a page token: SerpApi rejects
    // it on the first page ("it always returns 8 results"), which used to fail
    // every Google sync outright with a 400. So the first call sends none, and
    // each later page asks for what is still missing.
    const raw: Record<string, unknown>[] = [];
    let nextPageToken = "";
    let pages = 0;
    for (let page = 0; page < MAX_REVIEW_PAGES && raw.length < wanted; page += 1) {
      const response = await serpApi({
        engine: "google_maps_reviews",
        ...place,
        sort_by: "newestFirst",
        hl: "en",
        ...(nextPageToken ? { next_page_token: nextPageToken, num: wanted } : {}),
      });
      pages += 1;
      raw.push(...(response.reviews ?? []));
      nextPageToken = String(response.serpapi_pagination?.next_page_token ?? "");
      if (!nextPageToken) break;
    }

    const reviews = normaliseReviews(
      { reviews: raw.slice(0, wanted).map(mapGoogleReview) },
      "google",
    );
    return { reviews, searches: pages + (needsPlaceLookup("google", handle) ? 1 : 0) };
  }

  if (normalisedPlatform === "tripadvisor") {
    requireEnv("SERPAPI_KEY");
    const placeId = await resolveTripadvisorPlace(handle);
    const response = await serpApi({
      engine: "tripadvisor_reviews",
      place_id: placeId,
      sort_by: "most_recent",
      limit: wanted,
    });
    const raw = (response.reviews ?? []).map(mapTripadvisorReview);
    const reviews = normaliseReviews({ reviews: raw }, "tripadvisor");
    return { reviews, searches: 1 + (needsPlaceLookup("tripadvisor", handle) ? 1 : 0) };
  }

  const run = await startReviewScrape(normalisedPlatform, handle, wanted);
  return { reviews: await collectReviewScrape(normalisedPlatform, run, wanted), searches: 1 };
}

/* ------------------------------------------------------------- actor runs */

/**
 * How long one call waits for an actor before handing the run back.
 *
 * This is deliberately short: the caller — not this module — decides what to do
 * with a run that is still working, and for a billed actor the only correct
 * answer is to keep its id and collect it later rather than start another.
 */
export const REVIEW_RUN_WAIT_SECONDS = 60;

/** One review scrape, whether or not it has finished. */
export interface ReviewRun {
  id: string;
  status: string;
  /** Where the finished run's items live; empty until Apify assigns it. */
  datasetId: string;
  usageTotalUsd: number;
  statusMessage: string;
}

/** True once a run has stopped, so its dataset (if any) is final. */
export function reviewRunFinished(status: string): boolean {
  return isTerminal(status);
}

function toReviewRun(run: ApifyRun): ReviewRun {
  return {
    id: run.id,
    status: run.status,
    datasetId: run.defaultDatasetId,
    usageTotalUsd: run.usageTotalUsd,
    statusMessage: run.statusMessage ?? "",
  };
}

/** The actor a platform's reviews are read by, or a 409 that says what to set. */
function requireReviewActor(platform: string): string {
  const actorId = reviewActorFor(platform);
  if (!actorId) {
    throw new HttpError(
      409,
      `No review reader is configured for ${platformLabelOf(platform)}. Set APIFY_${platform.toUpperCase()}_REVIEWS_ACTOR_ID to an Apify actor that scrapes that platform's reviews.`,
    );
  }
  return actorId;
}

/**
 * Starts one review scrape and waits briefly for it. The run comes back either
 * way — still working is a normal, reportable outcome, not an error, because the
 * caller can hold its id and collect it on a later sync.
 */
export async function startReviewScrape(
  platform: string,
  handle: string,
  limit = DEFAULT_MAX_REVIEWS,
): Promise<ReviewRun> {
  const normalised = platform.trim().toLowerCase();
  requireEnv("APIFY_TOKEN");
  const actorId = requireReviewActor(normalised);
  const wanted = Math.min(MAX_REVIEWS_PER_CALL, Math.max(1, limit));

  const run = await startRun(actorId, reviewInputFor(normalised, handle, wanted), {
    maxItems: wanted,
    maxTotalChargeUsd: Number(getEnv("APIFY_MAX_CHARGE_USD") ?? 0.25) || 0.25,
    timeoutSecs: Number(getEnv("APIFY_RUN_TIMEOUT_SECS") ?? 300) || 300,
  });
  const settled = isTerminal(run.status)
    ? run
    : await waitForRun(run.id, REVIEW_RUN_WAIT_SECONDS);

  return toReviewRun(settled);
}

/**
 * Re-reads a run started earlier, so a scrape that outlived its first sync is
 * collected rather than paid for twice.
 */
export async function readReviewScrape(runId: string): Promise<ReviewRun> {
  requireEnv("APIFY_TOKEN");
  return toReviewRun(await waitForRun(runId, REVIEW_RUN_WAIT_SECONDS));
}

/**
 * The reviews a finished run produced. The run's state is checked **before** the
 * dataset is fetched, so an unfinished or failed run costs nothing to reject.
 */
export async function collectReviewScrape(
  platform: string,
  run: ReviewRun,
  limit = DEFAULT_MAX_REVIEWS,
): Promise<SyncedReview[]> {
  const normalised = platform.trim().toLowerCase();
  if (!reviewRunFinished(run.status)) {
    throw new HttpError(
      504,
      `The ${platformLabelOf(normalised)} review scrape is still running (${run.status}).`,
    );
  }
  if (run.status !== "SUCCEEDED") {
    throw new HttpError(
      502,
      run.statusMessage ||
        `The ${platformLabelOf(normalised)} review scrape did not finish (${run.status}).`,
    );
  }
  if (!run.datasetId) {
    throw new HttpError(502, `The ${platformLabelOf(normalised)} scrape finished without a dataset.`);
  }

  const wanted = Math.min(MAX_REVIEWS_PER_CALL, Math.max(1, limit));
  const items = await fetchDatasetItems(run.datasetId, wanted);
  const raw = items.map((item) => mapApifyReview(item, normalised));
  return normaliseReviews({ reviews: raw }, normalised);
}

/**
 * The page a URL-addressed review actor is pointed at. Only Yelp and G2 work
 * this way; Trustpilot is addressed by the company's own domain and Capterra by
 * a full profile URL, which `trustpilotDomain` / `capterraProfileUrl` build.
 */
function platformReviewUrl(platform: "yelp" | "g2", handle: string): string {
  const trimmed = handle.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const slug = trimmed.replace(/^@/, "");
  return platform === "yelp"
    ? `https://www.yelp.com/biz/${slug}`
    : `https://www.g2.com/products/${slug}/reviews`;
}

/** The G2 and Capterra actors both reject a limit below 10 outright. */
const MIN_ACTOR_REVIEWS = 10;

/**
 * Trustpilot addresses a company by its own website domain, not by a Trustpilot
 * URL. A review URL happens to carry that domain as its last path segment
 * (`/review/acme.com`), so a domain and a review URL reduce to the same value.
 */
function trustpilotDomain(handle: string): string {
  const withoutScheme = handle.trim().replace(/^https?:\/\//i, "");
  const afterReview = withoutScheme.match(/^[^/]*trustpilot\.[a-z.]+\/review\/([^/?#]+)/i);
  const candidate = (afterReview ? afterReview[1] : withoutScheme)
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(candidate)) {
    throw new HttpError(
      409,
      `Trustpilot is read by company website domain, and "${handle}" is not one. ` +
        "Enter the company's domain (for example acme.com) or its Trustpilot review URL.",
    );
  }
  return candidate;
}

/**
 * Capterra's actor needs a full profile URL, because the numeric product id only
 * exists there (`/p/135003/Slack`). A bare slug cannot be turned into one, so
 * say so rather than send a URL the actor would quietly return nothing for.
 */
function capterraProfileUrl(handle: string): string {
  const trimmed = handle.trim();
  if (/^https?:\/\/(?:[^/]*\.)?capterra\.[a-z.]+\/p\/\d+/i.test(trimmed)) return trimmed;
  throw new HttpError(
    409,
    `Capterra is read by full profile URL, since its product id is part of the address. "${handle}" ` +
      "is not one — paste the profile URL from Capterra (for example https://www.capterra.com/p/135003/Slack).",
  );
}

/**
 * The input a platform's review actor actually accepts.
 *
 * Every shape below was read off the actor's live schema
 * (`GET /v2/acts/{owner}~{name}/builds/default` → `inputSchema`), including its
 * required fields and enum values. That matters more than it looks: an actor
 * either refuses to start when a required field is missing, or accepts the run,
 * returns nothing, and charges for it either way.
 *
 *   yelp       → web_wanderer/yelp-reviews-scraper      biz_urls + reviews_limit
 *   g2         → zen-studio/g2-reviews-scraper          url (required) + limit
 *   trustpilot → casper11515/trustpilot-reviews-scraper companyWebsite (required)
 *   capterra   → azzouzana/capterra-reviews-scraper     profileUrls (required)
 *
 * The caller caps `limit` at 20 (a SerpApi review page), so the two actors whose
 * schema has a minimum of 10 are floored rather than sent a value they reject.
 */
export function reviewInputFor(
  platform: string,
  handle: string,
  limit: number,
): Record<string, unknown> {
  switch (platform.trim().toLowerCase()) {
    case "yelp":
      return {
        biz_urls: [platformReviewUrl("yelp", handle)],
        reviews_limit: limit,
        reviews_sort: "newest",
      };
    case "g2":
      return {
        url: platformReviewUrl("g2", handle),
        limit: Math.max(MIN_ACTOR_REVIEWS, limit),
        sortOrder: "most_recent",
      };
    case "trustpilot":
      return {
        companyWebsite: trustpilotDomain(handle),
        contentToExtract: "reviews",
        sortBy: "recency",
      };
    case "capterra":
      return {
        profileUrls: [capterraProfileUrl(handle)],
        maxReviewsPerProfile: Math.max(MIN_ACTOR_REVIEWS, limit),
      };
    default:
      // Stop rather than guess: a key this actor does not know still costs a run.
      throw new HttpError(
        409,
        `No review reader is wired up for ${platformLabelOf(platform)} yet.`,
      );
  }
}

/* -------------------------------------------------------------- replies */

export interface ReplyResult {
  replyId: string;
  repliedAt: string;
}

/**
 * The Google Business Profile API is the one compliant reply path, and it is not
 * wired up yet: it needs the tenant's own profile ingested through OAuth (and
 * Google's manual API-access approval) before Google will accept a reply, since
 * it only honours review ids it issued itself. Saying that plainly beats a
 * generic gateway failure.
 */
export function repliesConfigured(): boolean {
  return hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET");
}

export async function sendReply(_params: {
  platform: string;
  reviewExternalId: string;
  handle: string;
  body: string;
}): Promise<ReplyResult> {
  throw new HttpError(
    409,
    "Sending replies needs your own Google Business Profile connected, which this deployment does not have yet. " +
      "Reading and replying are separate permissions: Google only accepts replies to reviews it told us about directly. " +
      "Until that connection is set up, copy the suggested reply across by hand.",
  );
}

/* ----------------------------------------------------------- derivation */

export type ReviewSentiment = "positive" | "neutral" | "negative";

/** Star rating → sentiment, matching how the sample data is labelled. */
export function sentimentForRating(rating: number): ReviewSentiment {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

/** The suggested reply we seed the composer with, per sentiment. */
export function suggestedAction(rating: number, sentiment: ReviewSentiment): string {
  if (sentiment === "negative") {
    return rating <= 1
      ? "Reply today, apologise plainly and offer one concrete fix (refund, replacement or credit)."
      : "Reply with an apology and a concrete fix — a delivery credit usually resolves this.";
  }
  if (sentiment === "neutral") {
    return "Reply with a short thank-you and clarify the one thing they found confusing.";
  }
  return "Thank them and ask whether they would give a one-line testimonial for the next promotion.";
}

/* ------------------------------------------------------- webhook lookups */

/**
 * Reviews no longer arrive by webhook — SerpApi and Apify are pull-only, so the
 * sync runs from the UI (or a future schedule). The webhook function still needs
 * to recognise a stale review payload so it can acknowledge and drop it.
 */
export function isReviewWebhookEvent(event: string): boolean {
  return event.startsWith("review.") || event === "reply.created";
}

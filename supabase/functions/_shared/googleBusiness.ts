import { HttpError } from "./errors.ts";
import { getEnv, hasEnv } from "./env.ts";
import { fetchJson } from "./http.ts";

/**
 * Google Business Profile: the OAuth connection behind a review reply, and the
 * calls that make one.
 *
 * This is Phase B of replying. Reading a review and answering it are separate
 * permissions: SerpApi and Apify hand us a *scraped* id, and Google only
 * honours an id it minted itself against a location it told us about. So the
 * workspace connects its own profile once, we keep the refresh token server
 * side, and a reply is resolved against Google's own list of reviews for the
 * connected locations before it is posted.
 *
 * Everything here is plain HTTP against two Google surfaces:
 *
 *   oauth2.googleapis.com          code exchange and refresh
 *   mybusiness.googleapis.com/v4   accounts, locations, reviews, the reply
 *
 * The OAuth state is signed with the client secret rather than stored, so the
 * callback — a bare GET from Google with no session — can be trusted without a
 * session table, and cannot be replayed once its ten minutes are up.
 */

/** The one scope a reply needs; it also covers reading accounts and locations. */
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

/** The v4 Business Profile API — the surface that owns review replies. */
const API = "https://mybusiness.googleapis.com/v4";
const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o.oauth2/v2/auth";

/** How long an authorisation URL may sit unused before its state is refused. */
export const STATE_TTL_SECONDS = 600;

/** Pages of 50 reviews a reply will search before giving up on a location. */
const REVIEW_PAGES = 4;

/** True when the deployment holds the OAuth client a connection is made with. */
export function connectConfigured(): boolean {
  return hasEnv("GOOGLE_CLIENT_ID") && hasEnv("GOOGLE_CLIENT_SECRET");
}

/**
 * Where Google sends the user back: this function itself. It has to be
 * registered on the OAuth client verbatim — the console rejects a redirect
 * that is not listed, with an error Google shows on its own page rather than
 * here.
 */
export function redirectUri(): string {
  const base = (getEnv("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) throw new HttpError(500, "SUPABASE_URL is not set on the server.");
  return `${base}/functions/v1/google-connect`;
}

/* -------------------------------------------------------------------- state */

/** What the signed OAuth state carries across the round trip through Google. */
export interface GbpState {
  businessId: string;
  /** The Clerk user who started it, so a callback cannot be replayed for another tenant. */
  userId: string;
  /** The exact page to land back on, signed here because the callback cannot trust a header. */
  returnTo: string;
  /** Unix seconds. */
  exp: number;
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function stateKey(): Promise<CryptoKey> {
  const secret = getEnv("GOOGLE_CLIENT_SECRET");
  if (!secret) throw new HttpError(500, "GOOGLE_CLIENT_SECRET is not set on the server.");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Signs the round trip: who connected, which business, where to land. */
export async function signState(
  payload: Omit<GbpState, "exp">,
  nowMs = Date.now(),
): Promise<string> {
  const state: GbpState = { ...payload, exp: Math.floor(nowMs / 1000) + STATE_TTL_SECONDS };
  const body = new TextEncoder().encode(JSON.stringify(state));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(), body));
  return `${bytesToB64url(body)}.${bytesToB64url(mac)}`;
}

/** The signed state read back, or null when it is forged, altered or stale. */
export async function verifyState(state: string, nowMs = Date.now()): Promise<GbpState | null> {
  const [encodedBody, encodedMac] = String(state ?? "").split(".");
  if (!encodedBody || !encodedMac) return null;

  let body: Uint8Array<ArrayBuffer>;
  let given: Uint8Array<ArrayBuffer>;
  try {
    body = b64urlToBytes(encodedBody);
    given = b64urlToBytes(encodedMac);
  } catch {
    return null;
  }

  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", await stateKey(), body),
  );
  // Compared by hand rather than with ===: the signature is the only thing
  // standing between Google's callback and a forged business id.
  if (expected.length !== given.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ given[i];
  if (diff !== 0) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as GbpState;
    if (!parsed || typeof parsed.businessId !== "string" || !parsed.businessId) return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < nowMs) return null;
    if (typeof parsed.returnTo !== "string" || !parsed.returnTo) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The consent screen URL, with every parameter Google needs to round trip. */
export function authUrl(state: string): string {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  if (!clientId) throw new HttpError(500, "GOOGLE_CLIENT_ID is not set on the server.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GBP_SCOPE,
    // Offline access plus a forced consent screen: Google hands a refresh token
    // back only when consent is asked for again, and without one the
    // connection would die with the first access token.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/* -------------------------------------------------------------------- tokens */

/** The grant Google hands back for a code, or a refresh presents. */
export interface GoogleTokens {
  accessToken: string;
  /** Empty when Google withholds one — only possible if consent was not prompted. */
  refreshToken: string;
}

/** A grant Google will not accept again: the profile has to be reconnected. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new HttpError(500, "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on the server.");
  }

  let response: Response;
  try {
    // Form encoded, which is what Google's token endpoint accepts — unlike the
    // JSON everything else here speaks.
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
  } catch (cause) {
    throw new HttpError(502, `Google's token endpoint could not be reached: ${messageOf(cause)}`);
  }

  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  if (!response.ok) {
    const error = String(parsed.error ?? "");
    if (error === "invalid_grant" || error === "invalid_client") {
      throw new GoogleAuthError(
        "Google will not accept this grant again — the profile has to be connected once more.",
      );
    }
    throw new HttpError(
      502,
      `Google's token endpoint refused the request (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  return {
    accessToken: String(parsed.access_token ?? ""),
    refreshToken: String(parsed.refresh_token ?? ""),
  };
}

/** Swaps the consent-screen code for a grant, refresh token included. */
export function exchangeCode(code: string): Promise<GoogleTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });
}

/** Mints a fresh access token from the stored refresh token, per call. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  if (!refreshToken) throw new GoogleAuthError("The stored connection has no refresh token.");
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return tokens.accessToken;
}

/* ----------------------------------------------------------------- discovery */

export interface GoogleAccount {
  name: string;
  displayName: string;
}

export interface GoogleLocation {
  name: string;
  displayName: string;
}

async function authorized(url: string, accessToken: string): Promise<unknown> {
  return await fetchJson<unknown>(url, { headers: { Authorization: `Bearer ${accessToken}` } });
}

/** Every Business Profile account the grant can see (usually one). */
export async function listAccounts(accessToken: string): Promise<GoogleAccount[]> {
  const body = (await authorized(ACCOUNTS_URL, accessToken)) as {
    accounts?: Array<Record<string, unknown>>;
  };
  return (body.accounts ?? []).map((account) => ({
    name: String(account.name ?? ""),
    // `accountName` is what this API has called it; both are read so a name
    // never comes back blank and lands in the UI as "accounts/123".
    displayName: String(account.displayName ?? account.accountName ?? ""),
  }));
}

/** Every location on one account — a business with three shops lists three. */
export async function listLocations(
  accessToken: string,
  accountName: string,
): Promise<GoogleLocation[]> {
  const body = (await authorized(`${API}/${accountName}/locations?pageSize=100`, accessToken)) as {
    locations?: GoogleLocation[];
  };
  return (body.locations ?? []).map((location) => ({
    name: String(location.name ?? ""),
    displayName: String(location.displayName ?? ""),
  }));
}

/* ------------------------------------------------------------------- reviews */

/** One review as Google holds it, reduced to what matching needs. */
export interface GoogleReview {
  /** `accounts/1/locations/2/reviews/3` — the id a reply must be posted against. */
  name: string;
  author: string;
  rating: number;
  comment: string;
  /** True when the reviewer chose to stay anonymous — there is no name to match. */
  anonymous?: boolean;
}

/** What a reader stores when the reviewer hid their name, as our side of a match. */
const ANONYMOUS_LABELS = new Set([
  "agoogleuser",
  "googleuser",
  "areviewer",
  "anonymous",
  "user",
  "localguide",
]);

/**
 * The reviewer's display name, whichever shape Google answered with.
 *
 * The documented field is `reviewer.displayName`, and it is empty when the
 * reviewer opted to stay anonymous. `authorDisplayName` and a bare `author`
 * string have both appeared on this API, so anything else is read rather than
 * ignored — a name that silently came back blank would make every review
 * unmatchable.
 */
function reviewerNameOf(raw: Record<string, unknown>): string {
  const reviewer = raw.reviewer as Record<string, unknown> | undefined;
  const nested =
    reviewer && typeof reviewer.displayName === "string" ? reviewer.displayName.trim() : "";
  if (nested) return nested;
  if (typeof raw.authorDisplayName === "string") return raw.authorDisplayName.trim();
  if (typeof raw.author === "string") return raw.author.trim();
  return "";
}

const STAR_VALUES: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

function starOf(raw: unknown): number {
  if (typeof raw === "number") return raw;
  return STAR_VALUES[String(raw ?? "").toUpperCase()] ?? 0;
}

/** The review a row was matched to, for finding it in Google's own list. */
export interface ReviewToMatch {
  author?: string;
  rating?: number;
  text?: string;
}

/**
 * The reviews Google holds for one location, newest pages first.
 *
 * Capped at four pages of fifty: a reply is written for a review the customer
 * just left, and a location with two hundred older ones is not a search worth
 * making on every send.
 */
export async function listReviews(
  accessToken: string,
  locationName: string,
): Promise<GoogleReview[]> {
  const found: GoogleReview[] = [];
  let pageToken = "";

  for (let page = 0; page < REVIEW_PAGES; page += 1) {
    const query = new URLSearchParams({ pageSize: "50" });
    if (pageToken) query.set("pageToken", pageToken);
    const body = (await authorized(`${API}/${locationName}/reviews?${query}`, accessToken)) as {
      reviews?: Array<Record<string, unknown>>;
      nextPageToken?: string;
    };

    for (const raw of body.reviews ?? []) {
      const author = reviewerNameOf(raw);
      found.push({
        name: String(raw.name ?? ""),
        author,
        // Anonymous reviewers have no display name at all, which is the same
        // thing as a name that never arrived.
        anonymous: !author,
        rating: starOf(raw.starRating),
        comment: String(raw.comment ?? ""),
      });
    }

    pageToken = String(body.nextPageToken ?? "");
    if (!pageToken) break;
  }

  return found;
}

function normaliseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function wordSet(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/** Dice overlap of two word sets, 0 when either side has nothing to match. */
function textOverlap(left: string, right: string): number {
  const a = wordSet(left);
  const b = wordSet(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Finds the Google review a stored row refers to.
 *
 * Google allows one review per person per place, so the reviewer's name and the
 * star rating identify it; the body is only there to choose between two rows
 * that share both (a re-review, or the same name twice), and is scored rather
 * than required because readers may store a truncated comment. A row that
 * matches nothing matches nothing — a reply against the wrong review is worse
 * than no reply, so this returns null rather than its nearest guess.
 */
export function matchGoogleReview(
  reviews: GoogleReview[],
  want: ReviewToMatch,
): GoogleReview | null {
  const wanted = normaliseName(want.author ?? "");
  if (wanted.length < 2 && !ANONYMOUS_LABELS.has(wanted)) return null;

  let best: { review: GoogleReview; score: number } | null = null;

  for (const review of reviews) {
    let score: number;

    if (review.anonymous || ANONYMOUS_LABELS.has(normaliseName(review.author))) {
      // Nothing to compare names with: only the stars and the words can say
      // whether this is the same review, so both have to agree.
      if (!want.text) continue;
      const overlap = textOverlap(want.text, review.comment);
      if (overlap < 0.5) continue;
      if (want.rating && review.rating && want.rating !== review.rating) continue;
      score = (want.rating && review.rating === want.rating ? 2 : 0) + overlap * 2;
    } else {
      const candidate = normaliseName(review.author);
      if (candidate.length < 2) continue;

      // Exact name first; containment covers a reader that stores a full name
      // against Google's initialled display name, or the other way round.
      const nameScore =
        candidate === wanted
          ? 4
          : (candidate.includes(wanted) || wanted.includes(candidate)) &&
              Math.min(candidate.length, wanted.length) >= 3
            ? 2
            : 0;
      if (nameScore === 0) continue;
      if (want.rating && review.rating && want.rating !== review.rating) continue;

      score = nameScore + (want.rating && review.rating === want.rating ? 2 : 0) +
        textOverlap(want.text ?? "", review.comment) * 2;
    }

    if (!best || score > best.score) best = { review, score };
  }

  return best?.review ?? null;
}

/* --------------------------------------------------------------------- reply */

/** When Google will not accept a connection at all, and why. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A refusal to post a reply, in words the sender can act on.
 *
 * `fetchJson` collapses every non-retryable provider failure into a 502 with
 * the real status kept alongside it, which is exactly what is needed here: the
 * difference between "not approved for this API" and "this review id is not
 * ours" is the whole explanation, and neither is a server fault.
 */
export function replyRefusal(cause: unknown): unknown {
  if (!(cause instanceof HttpError)) return cause;

  const status = cause.providerStatus;
  const quoted = cause.message.slice(0, 200);

  if (status === 401 || status === 403) {
    return new HttpError(
      409,
      status === 401
        ? "Google no longer accepts this connection — reconnect your Google Business Profile, then send the reply again."
        : "Google has not granted this project Business Profile API access yet. Apply for access with Google for the project holding the OAuth client, then send again — nothing was posted. Google said: " +
          quoted,
      status,
    );
  }
  if (status === 404) {
    return new HttpError(
      409,
      "Google does not know this review id — it may have been removed, or the review was left on a location this connection does not cover. Nothing was posted.",
      404,
    );
  }
  if (status === 400) {
    // Google's own reason is the useful part: an unverified location and a
    // reply that breaches its policies both arrive here.
    return new HttpError(409, `Google refused the reply: ${quoted}. Nothing was posted.`, 400);
  }
  return cause;
}

/**
 * Posts the reply against Google's own review resource.
 *
 * `PUT /v4/{review}/reply` with a `ReviewReply` whose only settable field is
 * `comment` — the documented shape of `accounts.locations.reviews.updateReply`,
 * which creates the reply when the review has none. The resource name must be
 * one Google minted, which is why the caller resolves the review first.
 */
export async function postGoogleReply(
  accessToken: string,
  reviewName: string,
  text: string,
): Promise<string> {
  const name = reviewName.trim().replace(/^\/+/, "");
  if (!name) throw new HttpError(409, "There is no Google review to reply to.");

  try {
    const body = (await fetchJson<{ updateTime?: string }>(`${API}/${name}/reply`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { comment: text },
    })) as { updateTime?: string };
    return body.updateTime || new Date().toISOString();
  } catch (cause) {
    throw replyRefusal(cause);
  }
}

/**
 * Walks the connected locations until the review is found, and returns the
 * resource name to post against — empty when no location holds it.
 *
 * Every location is tried rather than one being chosen up front: a business
 * with a shop in two towns should not have to tell us which one the review was
 * left on, and the search is one cheap list per location.
 */
export async function resolveReviewName(
  accessToken: string,
  locationNames: string[],
  want: ReviewToMatch,
): Promise<string> {
  for (const locationName of locationNames) {
    if (!locationName) continue;
    let reviews: GoogleReview[];
    try {
      reviews = await listReviews(accessToken, locationName);
    } catch {
      // One unreadable location must not stop the others being searched.
      continue;
    }
    const match = matchGoogleReview(reviews, want);
    if (match) return match.name;
  }
  return "";
}

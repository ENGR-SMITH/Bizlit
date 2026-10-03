import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../supabase/functions/_shared/errors";
import {
  authUrl,
  exchangeCode,
  GoogleAuthError,
  listReviews,
  matchGoogleReview,
  postGoogleReply,
  redirectUri,
  refreshAccessToken,
  resolveReviewName,
  signState,
  STATE_TTL_SECONDS,
  verifyState,
} from "../supabase/functions/_shared/googleBusiness";
import { sendReply } from "../supabase/functions/_shared/reviews";

/**
 * Phase B of replying: the OAuth grant, the match that turns a scraped row into
 * an id Google will accept, and the PUT that posts against it.
 *
 * These drive the real module against a stubbed Google. The decisions worth
 * testing are all here: a state that cannot be forged, replayed or pointed
 * elsewhere; a match that refuses rather than guesses; and every refusal
 * translated into words the sender can act on.
 */

const env = new Map<string, string>();

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A Google that answers with whatever the test says, recording every call. */
function stubGoogle(
  handler: (call: FetchCall) => { status?: number; body?: unknown } = () => ({}),
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: FetchCall = {
      url: String(input),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ""),
    };
    calls.push(call);
    const { status = 200, body = {} } = handler(call);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    } as unknown as Response;
  });
  return calls;
}

/** The query builder `sendReply` chains, as far as this test is concerned. */
function fakeDb(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          updates.push(patch);
          return { error: null };
        },
      }),
    }),
  };
  return { db: db as unknown as Parameters<typeof sendReply>[0], updates };
}

/** The refusal a gateway answers with, or a failure that says what went wrong. */
async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  let caught: unknown;
  try {
    await promise;
  } catch (cause) {
    caught = cause;
  }
  if (!(caught instanceof HttpError)) {
    throw new Error(`expected an HttpError, got ${String(caught)}`);
  }
  return caught;
}

const CONNECTED = {
  id: "conn-1",
  status: "connected",
  refresh_token: "refresh-1",
  location_names: ["accounts/1/locations/2"],
  last_error: "",
};

const ROW = {
  businessId: "biz-1",
  platform: "google",
  reviewExternalId: "scraped-id",
  handle: "yourretailbrand",
  body: "Thank you Grace — enjoy the kit.",
  author: "Grace W.",
  rating: 5,
  text: "Received my lip kit in two days.",
};

beforeEach(() => {
  env.clear();
  env.set("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  env.set("GOOGLE_CLIENT_SECRET", "client-secret");
  env.set("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubGlobal("Deno", { env: { get: (name: string) => env.get(name) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the OAuth state", () => {
  const RETURN_TO = "http://localhost:5173/#/social";

  it("carries the round trip back to the workspace that started it", async () => {
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    const state = await verifyState(signed);

    expect(state).toMatchObject({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    expect(state?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("refuses a state signed with another secret", async () => {
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    env.set("GOOGLE_CLIENT_SECRET", "a-different-secret");

    expect(await verifyState(signed)).toBeNull();
  });

  it("refuses a state whose payload was swapped, and anything malformed", async () => {
    const signed = await signState({ businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO });
    const [, mac] = signed.split(".");
    // A signature over someone else's business id is still a signature — the
    // point is that only this deployment can make one.
    const forged = btoa(
      JSON.stringify({ businessId: "someone-else", userId: "user-a", returnTo: RETURN_TO, exp: 9_999_999_999 }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(await verifyState(`${forged}.${mac}`)).toBeNull();
    expect(await verifyState("not-a-state")).toBeNull();
    expect(await verifyState("")).toBeNull();
  });

  it("refuses a state that has timed out", async () => {
    const stale = await signState(
      { businessId: "biz-1", userId: "user-a", returnTo: RETURN_TO },
      Date.now() - (STATE_TTL_SECONDS + 30) * 1000,
    );

    expect(await verifyState(stale)).toBeNull();
  });
});

describe("the consent URL", () => {
  it("asks for exactly the grant a reply needs, and comes back to this function", async () => {
    const state = await signState({
      businessId: "biz-1",
      userId: "user-a",
      returnTo: "http://localhost:5173/#/social",
    });
    const url = new URL(authUrl(state));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o.oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://proj.supabase.co/functions/v1/google-connect",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    // Offline plus a forced consent screen: Google hands a refresh token back
    // only when consent is asked for again, and without one the connection
    // would die with the first access token.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("points at the deployed function, not the app", () => {
    expect(redirectUri()).toBe("https://proj.supabase.co/functions/v1/google-connect");
  });
});

describe("the token grant", () => {
  it("exchanges the code form-encoded, as Google's endpoint expects", async () => {
    const calls = stubGoogle(() => ({ body: { access_token: "at-1", refresh_token: "rt-1" } }));

    const tokens = await exchangeCode("code-123");

    expect(tokens).toEqual({ accessToken: "at-1", refreshToken: "rt-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(calls[0].body).toContain("grant_type=authorization_code");
    expect(calls[0].body).toContain("code=code-123");
    expect(calls[0].body).toContain(
      "redirect_uri=https%3A%2F%2Fproj.supabase.co%2Ffunctions%2Fv1%2Fgoogle-connect",
    );
  });

  it("turns a refused grant into the error that means reconnect", async () => {
    stubGoogle(() => ({ status: 400, body: { error: "invalid_grant" } }));

    await expect(exchangeCode("expired")).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(refreshAccessToken("refresh-1")).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("mints a fresh access token from the stored refresh token", async () => {
    const calls = stubGoogle(() => ({ body: { access_token: "at-2" } }));

    expect(await refreshAccessToken("refresh-1")).toBe("at-2");
    expect(calls[0].body).toContain("grant_type=refresh_token");
    expect(calls[0].body).toContain("refresh_token=refresh-1");
  });

  it("refuses an empty refresh token without calling Google", async () => {
    const calls = stubGoogle();

    await expect(refreshAccessToken("")).rejects.toBeInstanceOf(GoogleAuthError);
    expect(calls).toHaveLength(0);
  });
});

describe("matching a stored review to Google's own list", () => {
  const review = (overrides: Record<string, unknown> = {}) => ({
    name: "accounts/1/locations/2/reviews/r1",
    author: "Grace W.",
    rating: 5,
    comment: "Received my lip kit in two days.",
    ...overrides,
  });

  it("takes the review with the same name and stars", () => {
    const match = matchGoogleReview(
      [
        review(),
        review({ name: "accounts/1/locations/2/reviews/r2", author: "Peter M.", rating: 2 }),
      ],
      { author: "Grace W.", rating: 5, text: "Received my lip kit in two days." },
    );

    expect(match?.name).toBe("accounts/1/locations/2/reviews/r1");
  });

  it("will not answer for a review with different stars", () => {
    expect(matchGoogleReview([review({ rating: 3 })], { author: "Grace W.", rating: 5 })).toBeNull();
  });

  it("recognises the same reviewer under a fuller display name", () => {
    const match = matchGoogleReview([review({ author: "Grace Wanyama" })], {
      author: "Grace W.",
      rating: 5,
    });

    expect(match?.name).toBe("accounts/1/locations/2/reviews/r1");
  });

  it("uses the text to choose between two rows sharing a name and rating", () => {
    const match = matchGoogleReview(
      [
        review({ name: "…/r1", comment: "The blush palette was out of stock again." }),
        review({ name: "…/r2", comment: "Received my lip kit in two days." }),
      ],
      { author: "Grace W.", rating: 5, text: "Received my lip kit in two days." },
    );

    expect(match?.name).toBe("…/r2");
  });

  it("returns nothing rather than its nearest guess", () => {
    // A reply against the wrong review is worse than no reply at all.
    expect(matchGoogleReview([review()], { author: "", rating: 5 })).toBeNull();
    expect(matchGoogleReview([review()], { author: "Someone Else", rating: 5 })).toBeNull();
    expect(matchGoogleReview([], { author: "Grace W.", rating: 5 })).toBeNull();
  });

  it("finds an anonymous reviewer by the stars and the words alone", () => {
    // Google shows "A Google user" for a reviewer who hid their name, so there
    // is nothing to compare — only what they wrote and how many stars.
    const match = matchGoogleReview(
      [
        {
          name: "…/r5",
          author: "",
          anonymous: true,
          rating: 4,
          comment: "Great prices but I could not find the blush palette under Face.",
        },
      ],
      {
        author: "A Google user",
        rating: 4,
        text: "Great prices but I could not find the blush palette under Face.",
      },
    );

    expect(match?.name).toBe("…/r5");
  });
});

describe("reading the connected location's reviews", () => {
  it("reduces Google's stars to ours and follows the next page", async () => {
    const calls = stubGoogle((call) =>
      call.url.includes("pageToken=next")
        ? {
            body: {
              reviews: [
                {
                  name: "…/r2",
                  reviewer: { displayName: "Peter M.", isAnonymous: false },
                  starRating: "TWO",
                  comment: "late",
                },
              ],
            },
          }
        : {
            body: {
              reviews: [
                {
                  name: "…/r1",
                  reviewer: { displayName: "Grace W.", isAnonymous: false },
                  starRating: "FIVE",
                  comment: "great",
                },
              ],
              nextPageToken: "next",
            },
          },
    );

    const reviews = await listReviews("at-1", "accounts/1/locations/2");

    expect(reviews).toEqual([
      { name: "…/r1", author: "Grace W.", anonymous: false, rating: 5, comment: "great" },
      { name: "…/r2", author: "Peter M.", anonymous: false, rating: 2, comment: "late" },
    ]);
    expect(calls[1].url).toContain("pageToken=next");
  });

  it("reads a reviewer who hid their name as anonymous", async () => {
    stubGoogle(() => ({
      body: {
        reviews: [{ name: "…/r3", reviewer: { isAnonymous: true }, starRating: "THREE", comment: "ok" }],
      },
    }));

    const [review] = await listReviews("at-1", "accounts/1/locations/2");

    expect(review).toMatchObject({ name: "…/r3", author: "", anonymous: true, rating: 3 });
  });

  it("walks the connected locations and stops at the first that matches", async () => {
    const calls = stubGoogle((call) =>
      call.url.includes("accounts/1/locations/2/reviews")
        ? {
            body: {
              reviews: [
                {
                  name: "…/r1",
                  reviewer: { displayName: "Grace W.", isAnonymous: false },
                  starRating: "FIVE",
                  comment: "hi",
                },
              ],
            },
          }
        : { body: { reviews: [] } },
    );

    const found = await resolveReviewName(
      "at-1",
      ["accounts/1/locations/9", "accounts/1/locations/2", "accounts/1/locations/3"],
      { author: "Grace W.", rating: 5, text: "hi" },
    );

    expect(found).toBe("…/r1");
    // The third location was never asked: one match ends the walk.
    expect(calls.filter((call) => call.url.includes("/reviews")).length).toBe(2);
  });

  it("keeps searching when one location cannot be read", async () => {
    stubGoogle((call) =>
      call.url.includes("accounts/1/locations/9/reviews")
        ? { status: 403, body: { error: "forbidden" } }
        : {
            body: {
              reviews: [
                {
                  name: "…/r2",
                  reviewer: { displayName: "Peter M.", isAnonymous: false },
                  starRating: "TWO",
                  comment: "late",
                },
              ],
            },
          },
    );

    const found = await resolveReviewName(
      "at-1",
      ["accounts/1/locations/9", "accounts/1/locations/2"],
      { author: "Peter M.", rating: 2 },
    );

    expect(found).toBe("…/r2");
  });
});

describe("posting the reply", () => {
  it("PUTs the reply against Google's own review resource", async () => {
    const calls = stubGoogle(() => ({ body: { updateTime: "2026-10-02T12:00:00Z" } }));

    const repliedAt = await postGoogleReply(
      "at-1",
      "accounts/1/locations/2/reviews/r1",
      "Thank you Grace.",
    );

    expect(repliedAt).toBe("2026-10-02T12:00:00Z");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/r1/reply",
    );
    expect(calls[0].headers.Authorization).toBe("Bearer at-1");
    // `ReviewReply.comment` is the only settable field — the reply, not an
    // edit of the review itself.
    expect(JSON.parse(calls[0].body)).toEqual({ comment: "Thank you Grace." });
  });

  it("says plainly when Google does not know the review", async () => {
    stubGoogle(() => ({ status: 404, body: { error: "not found" } }));

    const error = await refusal(postGoogleReply("at-1", "…/r9", "hi"));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/does not know this review id/);
  });

  it("says plainly when this project may not use the API yet", async () => {
    stubGoogle(() => ({
      status: 403,
      body: {
        error: { status: "PERMISSION_DENIED", message: "Google Maps Platform API access not granted" },
      },
    }));

    const error = await refusal(postGoogleReply("at-1", "…/r1", "hi"));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/Business Profile API access/);
  });
});

describe("sendReply", () => {
  it("refuses a platform that has no compliant reply API here", async () => {
    const { db } = fakeDb(CONNECTED);

    const error = await refusal(sendReply(db, { ...ROW, platform: "trustpilot" }));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/copy the reply across by hand/);
  });

  it("names the variables when the deployment has no OAuth client", async () => {
    env.delete("GOOGLE_CLIENT_ID");
    const { db } = fakeDb(CONNECTED);

    const error = await refusal(sendReply(db, ROW));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/GOOGLE_CLIENT_ID/);
  });

  it("asks for the connection before it asks Google anything", async () => {
    const { db } = fakeDb(null);
    const calls = stubGoogle();

    const error = await refusal(sendReply(db, ROW));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/Connect your Google Business Profile first/);
    expect(calls).toHaveLength(0);
  });

  it("says the grant expired rather than failing the same way twice", async () => {
    const { db } = fakeDb({ ...CONNECTED, status: "needs_reauth" });

    const error = await refusal(sendReply(db, ROW));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/expired/);
  });

  it("marks the connection for reconnecting when Google refuses the grant", async () => {
    const { db, updates } = fakeDb(CONNECTED);
    stubGoogle(() => ({ status: 400, body: { error: "invalid_grant" } }));

    const error = await refusal(sendReply(db, ROW));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/reconnect your Google Business Profile/);
    expect(updates[0]).toMatchObject({ status: "needs_reauth" });
  });

  it("posts straight against a review this row was already matched to", async () => {
    const { db } = fakeDb(CONNECTED);
    const calls = stubGoogle(() => ({ body: { updateTime: "2026-10-02T12:00:00Z" } }));

    const sent = await sendReply(db, {
      ...ROW,
      googleReviewName: "accounts/1/locations/2/reviews/r1",
    });

    expect(sent).toEqual({
      replyId: "accounts/1/locations/2/reviews/r1/reply",
      repliedAt: "2026-10-02T12:00:00Z",
      reviewName: "accounts/1/locations/2/reviews/r1",
    });
    // Refresh and reply only — no search, so a cached row cannot drift onto a
    // different review.
    expect(calls).toHaveLength(2);
    expect(calls.filter((call) => call.method !== "PUT")).toHaveLength(1);
  });

  it("resolves the row against the connected location when it has never been matched", async () => {
    const { db } = fakeDb(CONNECTED);
    const calls = stubGoogle((call) => {
      if (call.url.includes("oauth2.googleapis.com")) return { body: { access_token: "at-1" } };
      if (call.method === "PUT") return { body: { updateTime: "2026-10-02T12:00:00Z" } };
      return {
        body: {
          reviews: [
            {
              name: "accounts/1/locations/2/reviews/r7",
              reviewer: { displayName: "Grace W.", isAnonymous: false },
              starRating: "FIVE",
              comment: "Received my lip kit in two days.",
            },
          ],
        },
      };
    });

    const sent = await sendReply(db, ROW);

    expect(sent.reviewName).toBe("accounts/1/locations/2/reviews/r7");
    expect(calls.some((call) => call.url.includes("/reviews?"))).toBe(true);
    expect(calls.some((call) => call.method === "PUT")).toBe(true);
  });

  it("refuses when no connected location holds a review like this one", async () => {
    const { db } = fakeDb(CONNECTED);
    stubGoogle((call) =>
      call.url.includes("oauth2.googleapis.com")
        ? { body: { access_token: "at-1" } }
        : { body: { reviews: [] } },
    );

    const error = await refusal(sendReply(db, ROW));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/does not list a review matching/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAlerts } from "../src/lib/alerts";
import { sampleWorkspace } from "../src/data/sample";
import { reviewPlatformLabel } from "../src/lib/format";
import {
  collectReviewScrape,
  mapApifyReview,
  mapGoogleReview,
  mapTripadvisorReview,
  needsPlaceLookup,
  normaliseReview,
  normaliseReviews,
  platformLabelOf,
  readReviewScrape,
  readerFor,
  reviewInputFor,
  reviewRunFinished,
  reviewTrendLabel,
  REVIEW_PLATFORMS,
  REVIEW_TREND_WINDOW,
  sentimentForRating,
  startReviewScrape,
  suggestedAction,
} from "../supabase/functions/_shared/reviews";

describe("the trend point a sync writes", () => {
  it("labels a point with the day, so every refresh adds a bar", () => {
    // A month label meant a workspace's first weeks of scanning produced a
    // single lonely column; a day label means the chart accrues a reading each
    // time it is run, and a same-day re-run updates that reading rather than
    // stacking a second one.
    expect(reviewTrendLabel(new Date("2026-10-02T13:45:00Z"))).toBe("2026-10-02");
    expect(reviewTrendLabel(new Date("2026-10-02T23:59:59Z"))).toBe("2026-10-02");
  });

  it("keeps a window of days rather than growing forever", () => {
    // Two months of daily bars is a trend a chart can draw; a year of them is a
    // smear, so the oldest days age out at the window.
    expect(REVIEW_TREND_WINDOW).toBeGreaterThanOrEqual(30);
    expect(REVIEW_TREND_WINDOW).toBeLessThan(365);
  });
});

describe("review actor payloads", () => {
  it("sends Yelp and G2 the input their actors accept", () => {
    expect(reviewInputFor("yelp", "acme-coffee", 20)).toMatchObject({
      biz_urls: ["https://www.yelp.com/biz/acme-coffee"],
      reviews_limit: 20,
      reviews_sort: "newest",
    });
    expect(reviewInputFor("g2", "acme", 20)).toMatchObject({
      url: "https://www.g2.com/products/acme/reviews",
      limit: 20,
      sortOrder: "most_recent",
    });
  });

  it("never sends the startUrls key the review actors reject", () => {
    const handles = [
      ["yelp", "acme-coffee"],
      ["g2", "acme"],
      ["trustpilot", "acme.com"],
      ["capterra", "https://www.capterra.com/p/135003/Slack"],
    ] as const;

    for (const [platform, handle] of handles) {
      expect(reviewInputFor(platform, handle, 20)).not.toHaveProperty("startUrls");
    }
  });

  it("floors the limit where an actor's schema rejects a value under 10", () => {
    expect(reviewInputFor("g2", "acme", 5).limit).toBe(10);
    expect(reviewInputFor("capterra", "https://www.capterra.com/p/135003/Slack", 5)).toMatchObject({
      maxReviewsPerProfile: 10,
    });
  });

  it("reads Trustpilot's company domain out of either handle form", () => {
    expect(reviewInputFor("trustpilot", "https://www.trustpilot.com/review/acme.com", 20)).toMatchObject({
      companyWebsite: "acme.com",
      contentToExtract: "reviews",
    });
    expect(reviewInputFor("trustpilot", "acme.com", 20)).toMatchObject({ companyWebsite: "acme.com" });
  });

  it("keeps Capterra's product id, which only the pasted URL carries", () => {
    expect(reviewInputFor("capterra", "https://www.capterra.com/p/135003/Slack", 20)).toMatchObject({
      profileUrls: ["https://www.capterra.com/p/135003/Slack"],
    });
  });

  it("refuses a handle that cannot become what the actor needs", () => {
    expect(() => reviewInputFor("trustpilot", "Acme Coffee", 20)).toThrow(/domain/i);
    expect(() => reviewInputFor("capterra", "acme-coffee", 20)).toThrow(/profile URL/i);
  });
});

describe("review normalisation", () => {
  it("reads the provider's own field names", () => {
    const review = normaliseReview(
      {
        id: "rev_8421",
        platform: "trustpilot",
        rating: 5,
        author: "Jordan M.",
        language: "en",
        text: "Fast, friendly, it just worked.",
        date: "2026-07-20",
      },
      "trustpilot",
    );

    expect(review).toMatchObject({
      externalId: "rev_8421",
      platform: "trustpilot",
      author: "Jordan M.",
      rating: 5,
      language: "en",
      text: "Fast, friendly, it just worked.",
    });
    expect(review?.postedAt).toBe("2026-07-20T00:00:00.000Z");
    expect(review?.replied).toBe(false);
  });

  it("derives a stable id when the provider omits one, so re-syncs de-duplicate", () => {
    const raw = { rating: 4, author: "Amina", text: "Great delivery", date: "2026-07-20" };

    const first = normaliseReview(raw, "google");
    const second = normaliseReview({ ...raw }, "google");

    expect(first?.externalId).toMatch(/^rf-/);
    expect(first?.externalId).toBe(second?.externalId);
    expect(normaliseReviews({ reviews: [raw, { ...raw }] }, "google")).toHaveLength(1);
  });

  it("treats a provider reply as replied and keeps its text", () => {
    const review = normaliseReview(
      {
        id: "rev_1",
        rating: 2,
        text: "Arrived late",
        replied: true,
        reply: { text: "Sorry about that — credit applied." },
      },
      "trustpilot",
    );

    expect(review?.replied).toBe(true);
    expect(review?.replyText).toBe("Sorry about that — credit applied.");
  });

  it("drops a review with no content and no identity", () => {
    expect(normaliseReview({ rating: 3 }, "google")).toBeNull();
  });

  it("clamps ratings into the 0–5 star range", () => {
    expect(normaliseReview({ id: "a", rating: 9, text: "x" }, "google")?.rating).toBe(5);
    expect(normaliseReview({ id: "b", rating: -2, text: "y" }, "google")?.rating).toBe(0);
  });
});

describe("review helpers", () => {
  it("maps a star rating onto sentiment", () => {
    expect(sentimentForRating(5)).toBe("positive");
    expect(sentimentForRating(4)).toBe("positive");
    expect(sentimentForRating(3)).toBe("neutral");
    expect(sentimentForRating(2)).toBe("negative");
    expect(sentimentForRating(1)).toBe("negative");
  });

  it("suggests a reply that matches the sentiment", () => {
    expect(suggestedAction(1, "negative")).toMatch(/apologise/i);
    expect(suggestedAction(3, "neutral")).toMatch(/thank-you/i);
    expect(suggestedAction(5, "positive")).toMatch(/testimonial/i);
  });

  it("labels known platforms and passes unknown ones through", () => {
    expect(platformLabelOf("google")).toBe("Google Reviews");
    expect(platformLabelOf("tripadvisor")).toBe("TripAdvisor");
    expect(platformLabelOf("glassdoor")).toBe("glassdoor");
  });
});

describe("the platform tag a review is shown with", () => {
  it("reads exactly as the reader labels the same platform", () => {
    // The browser cannot import the Deno-side reader, so its display names are
    // copied into `src/lib/format.ts` for the tag on each review. Without this
    // the two silently drift and a tag starts disagreeing with the sync that
    // wrote the row it sits next to.
    for (const platform of REVIEW_PLATFORMS) {
      expect(reviewPlatformLabel(platform)).toBe(platformLabelOf(platform));
    }
  });

  it("falls back to the row's own source rather than a blank tag", () => {
    // A row saved before `my_reviews.platform` existed has no key to label, and
    // an unknown key must show its real name instead of an invented one.
    expect(reviewPlatformLabel("")).toBe("");
    expect(reviewPlatformLabel("glassdoor")).toBe("glassdoor");
    expect(reviewPlatformLabel("  G2 ")).toBe("G2");
  });
});

describe("review alerts", () => {
  it("flags an overdue negative review, a slipping source and a widening gap", () => {
    const titles = buildAlerts(sampleWorkspace()).map((alert) => alert.title);

    expect(titles).toContain("1 review awaiting a reply over 48h");
    expect(titles).toContain("Trustpilot: review score slipped");
    expect(titles).toContain("GlowMart Beauty: review gap widened");
  });

  it("does not flag a source that is holding steady", () => {
    const ids = buildAlerts(sampleWorkspace()).map((alert) => alert.id);

    // Google Reviews improved (4.4 → 4.6), so it must not raise a slip alert.
    expect(ids).not.toContain("alert-review-source-Google Reviews");
    // TecWave has no previous gap recorded, so it cannot be "widening".
    expect(ids).not.toContain("alert-review-gap-comp-tecwave");
  });
});

describe("provider mapping", () => {
  it("maps a SerpApi Google Maps review, including the owner's reply", () => {
    const review = normaliseReview(
      mapGoogleReview({
        review_id: "ChdDSUhN",
        rating: 2,
        snippet: "Arrived late and no update.",
        extracted_snippet: { original: "Arrived late and no update." },
        iso_date: "2026-07-18",
        user: { name: "Amina R." },
        response: {
          snippet: "Sorry — a credit is on its way.",
          extracted_snippet: { original: "Sorry — a credit is on its way." },
        },
      }),
      "google",
    );

    expect(review).toMatchObject({
      externalId: "ChdDSUhN",
      platform: "google",
      author: "Amina R.",
      rating: 2,
      text: "Arrived late and no update.",
      replied: true,
    });
    expect(review?.replyText).toBe("Sorry — a credit is on its way.");
    expect(review?.postedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("treats a Google review with no owner response as unanswered", () => {
    const review = normaliseReview(
      mapGoogleReview({ review_id: "abc", rating: 5, snippet: "Lovely", user: { name: "Jo" } }),
      "google",
    );

    expect(review?.replied).toBe(false);
    expect(review?.replyText).toBe("");
  });

  it("maps a Tripadvisor review and keeps its title with the body", () => {
    const review = normaliseReview(
      mapTripadvisorReview({
        review_id: "1051450051",
        title: "A true gem",
        snippet: "Generous portions, bold flavours.",
        rating: 5,
        date: "2026-02-28",
        language: "en",
        author: { display_name: "Carla Revill", username: "CarlaRevill" },
      }),
      "tripadvisor",
    );

    expect(review).toMatchObject({
      externalId: "1051450051",
      platform: "tripadvisor",
      author: "Carla Revill",
      rating: 5,
      language: "en",
    });
    expect(review?.text).toBe("A true gem\n\nGenerous portions, bold flavours.");
  });

  it("reads an Apify actor item's common spellings, including an owner response", () => {
    const review = normaliseReview(
      mapApifyReview(
        {
          reviewId: "tp-9",
          stars: "4",
          text: "Good value",
          publishedDate: "2026-01-05",
          author: { name: "Sam" },
          ownerResponse: { text: "Thanks Sam!" },
        },
        "trustpilot",
      ),
      "trustpilot",
    );

    expect(review).toMatchObject({ externalId: "tp-9", rating: 4, author: "Sam", replied: true });
    expect(review?.replyText).toBe("Thanks Sam!");
  });
});

describe("reader routing", () => {
  it("sends Google and Tripadvisor through SerpApi and the rest through Apify", () => {
    expect(readerFor("google")).toBe("serpapi");
    expect(readerFor("TripAdvisor")).toBe("serpapi");
    expect(readerFor("trustpilot")).toBe("apify");
    expect(readerFor("g2")).toBe("apify");
    expect(readerFor("capterra")).toBe("apify");
  });

  it("only charges a place lookup when the handle is not already the id wanted", () => {
    expect(needsPlaceLookup("google", "0x89c25a1b:0x7f3d2e")).toBe(false);
    expect(needsPlaceLookup("google", "ChIJN1t_tDeuEmsRUsoyG83frY4")).toBe(false);
    expect(needsPlaceLookup("google", "Your Retail Brand")).toBe(true);

    expect(needsPlaceLookup("tripadvisor", "33008559")).toBe(false);
    expect(
      needsPlaceLookup(
        "tripadvisor",
        "https://www.tripadvisor.com/Restaurant_Review-g186338-d33008559-Reviews",
      ),
    ).toBe(false);
    expect(needsPlaceLookup("tripadvisor", "Pasta Bar London")).toBe(true);
  });
});

/**
 * The three actors agree on almost none of their field names, and each item
 * below is a real captured item from that actor's live dataset. An unread field
 * does not throw — it yields a 0-star review with no text — so these pin the
 * spellings down.
 */
describe("live actor field names", () => {
  it("reads the Yelp actor's names: reviewEncid, author, reviewDate, publicReply", () => {
    const review = normaliseReview(
      mapApifyReview(
        {
          encid: "qlNIrY3x0eivDug3wFPUkA",
          alias: "rei-seattle-2",
          name: "REI",
          businessRating: 4.1,
          reviewEncid: "QGEHExojS8yLEJTQMU-4kA",
          text: "After over 15 years of membership here, I would recommend the north face products quality.",
          language: "en",
          rating: 3,
          publicReply: "Thanks for the long membership!",
          author: "Marcus D.",
          reviewDate: "2026-08-14T00:00:00.000Z",
        },
        "yelp",
      ),
      "yelp",
    );

    expect(review).toMatchObject({
      externalId: "QGEHExojS8yLEJTQMU-4kA",
      author: "Marcus D.",
      rating: 3,
      replied: true,
    });
    expect(review?.replyText).toBe("Thanks for the long membership!");
    expect(review?.postedAt).toBe("2026-08-14T00:00:00.000Z");
  });

  it("reads G2's starRating and reviewerName", () => {
    const review = normaliseReview(
      mapApifyReview(
        {
          reviewId: "13623488",
          title: "Very Reliable for Team Communication",
          starRating: 5,
          date: "2026-09-27",
          text: "Slack brings meeting, chats, and file sharing into one place.",
          reviewerName: "Catherine R.",
        },
        "g2",
      ),
      "g2",
    );

    expect(review).toMatchObject({
      externalId: "13623488",
      author: "Catherine R.",
      rating: 5,
      text: "Slack brings meeting, chats, and file sharing into one place.",
    });
    expect(review?.postedAt).toBe("2026-09-27T00:00:00.000Z");
  });

  it("reads Capterra's overallRating, generalComments and nested reviewer", () => {
    const review = normaliseReview(
      mapApifyReview(
        {
          reviewId: "Capterra___7202161",
          title: "Corporate Social Media platform",
          writtenOn: "August 20, 2026",
          generalComments: "Wonderful. The chat feature is great.",
          overallRating: "5.0",
          reviewer: { fullName: "Priya S.", jobTitle: "Subject Matter Expert" },
          vendorResponse: { text: "Thanks Priya!" },
        },
        "capterra",
      ),
      "capterra",
    );

    expect(review).toMatchObject({
      externalId: "Capterra___7202161",
      author: "Priya S.",
      rating: 5,
      text: "Wonderful. The chat feature is great.",
      replied: true,
    });
    expect(review?.postedAt).not.toBeNull();
  });

  it("leaves the author blank when the actor carries no name, so the caller defaults it", () => {
    // A real Yelp item: the actor returns the author object with every field null.
    const review = normaliseReview(
      mapApifyReview(
        {
          reviewEncid: "QGEHExojS8yLEJTQMU-4kA",
          rating: 5,
          text: "Huge REI store with an amazing selection.",
          author: { name: null, elite_years: [], isEliteAllStar: null },
        },
        "yelp",
      ),
      "yelp",
    );

    expect(review?.author).toBe("Customer");
  });

  it("falls back to Capterra's split pros and cons when there is no summary", () => {
    const review = normaliseReview(
      mapApifyReview({ reviewId: "x", prosText: "Fast", consText: "Pricey" }, "capterra"),
      "capterra",
    );

    expect(review?.text).toBe("Fast\n\nPricey");
  });
});

/**
 * A billed actor that outlives the sync's wait must be *kept*, not thrown away:
 * the run id is what lets a later sync collect the scrape that was already paid
 * for, instead of buying a second run. These drive the real client against a
 * stubbed Apify, so the cycle under test is the one that ships.
 */
describe("deferred review scrape", () => {
  const denoEnv = new Map<string, string>([
    ["APIFY_TOKEN", "test-token"],
    ["APIFY_G2_REVIEWS_ACTOR_ID", "test-owner~g2-reviews"],
    ["APIFY_MAX_CHARGE_USD", "0.25"],
  ]);
  const handle = "https://www.g2.com/products/slack/reviews";
  let runStatus = "RUNNING";
  let datasetCalls = 0;

  beforeEach(() => {
    runStatus = "RUNNING";
    datasetCalls = 0;
    vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      const reply = (body: unknown) =>
        ({
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as unknown as Response;

      if (url.includes("/datasets/")) {
        datasetCalls += 1;
        return reply([
          {
            reviewId: "13623488",
            starRating: 5,
            text: "Solid platform.",
            reviewerName: "Catherine R.",
            date: "2026-09-27",
          },
        ]);
      }
      if (url.includes("/actor-runs/")) {
        return reply({
          data: {
            id: "run-1",
            status: runStatus,
            defaultDatasetId: "ds-1",
            usageTotalUsd: 0.0649,
          },
        });
      }
      // POST /actors/{actor}/runs — the run starts, still working.
      return reply({
        data: { id: "run-1", status: "RUNNING", defaultDatasetId: "ds-1", usageTotalUsd: 0 },
      });
    });
  });

  it("hands back a run that outlives the wait, with its id, instead of losing it", async () => {
    const run = await startReviewScrape("g2", handle, 20);

    expect(reviewRunFinished(run.status)).toBe(false);
    expect(run.id).toBe("run-1");
    // Nothing was read — there is nothing to read yet, and the id is what lets a
    // later sync finish the job rather than start another billed run.
    expect(datasetCalls).toBe(0);
  });

  it("collects that same run on a later sync, reporting the charge once", async () => {
    const first = await startReviewScrape("g2", handle, 20);
    runStatus = "SUCCEEDED";

    const second = await readReviewScrape(first.id);
    expect(reviewRunFinished(second.status)).toBe(true);

    const reviews = await collectReviewScrape("g2", second, 20);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      externalId: "13623488",
      rating: 5,
      author: "Catherine R.",
      text: "Solid platform.",
    });
    // The cost belongs to the run we started once, so it is reported from there.
    expect(second.usageTotalUsd).toBe(0.0649);
    expect(datasetCalls).toBe(1);
  });

  it("refuses to collect a run that is still working, without spending a call", async () => {
    const run = await startReviewScrape("g2", handle, 20);
    const before = datasetCalls;

    await expect(collectReviewScrape("g2", run, 20)).rejects.toThrow(/still running/i);
    expect(datasetCalls).toBe(before);
  });

  it("reports a run that failed rather than presenting it as raw reviews", async () => {
    runStatus = "FAILED";
    const run = await readReviewScrape("run-1");

    expect(run.status).toBe("FAILED");
    await expect(collectReviewScrape("g2", run, 20)).rejects.toThrow(/FAILED/);
    expect(datasetCalls).toBe(0);
  });
});
